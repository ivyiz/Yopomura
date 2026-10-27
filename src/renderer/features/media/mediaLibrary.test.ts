import path from "node:path";
import { describe, expect, it } from "vitest";
import {
    continueWatchingVideos,
    DEFAULT_SCAN_MAX_DEPTH,
    filterAndSortVideos,
    formatBytes,
    formatTime,
    isVideoPath,
    type MediaPositionStorage,
    POSITION_KEY_PREFIX,
    positionStorageKey,
    readWatchedPosition,
    readWatchedPositions,
    removeWatchedPosition,
    scanVideoEntries,
    seekPreviewLeft,
    type VideoEntry,
    type VideoScanIo,
    writeWatchedPosition,
} from "./mediaLibrary";

type TreeFile = { kind: "file"; size: number; mtimeMs: number };
type TreeDir = { kind: "dir" };
type TreeNode = TreeFile | TreeDir;
type Tree = Record<string, Record<string, TreeNode>>;

const file = (size = 1024, mtimeMs = 1_700_000_000_000): TreeFile => ({ kind: "file", size, mtimeMs });
const dir = (): TreeDir => ({ kind: "dir" });

/** Small in-memory filesystem that mirrors the preload `readdir`/`stat` shape. */
const createIo = (tree: Tree): VideoScanIo => ({
    readdir: async (directory) => {
        const node = tree[directory];
        if (!node) throw new Error(`ENOENT: ${directory}`);
        return Object.keys(node);
    },
    stat: async (target) => {
        for (const [directory, children] of Object.entries(tree)) {
            if (directory === target) {
                return { isDirectory: true, sizeBytes: 0, modifiedMs: 0 };
            }
            for (const [name, node] of Object.entries(children)) {
                if (path.posix.join(directory, name) !== target) continue;
                return node.kind === "dir"
                    ? { isDirectory: true, sizeBytes: 0, modifiedMs: 0 }
                    : { isDirectory: false, sizeBytes: node.size, modifiedMs: node.mtimeMs };
            }
        }
        throw new Error(`ENOENT: ${target}`);
    },
    join: path.posix.join,
});

const createStorage = (): MediaPositionStorage & { entries: Map<string, string> } => {
    const entries = new Map<string, string>();
    return {
        entries,
        get length() {
            return entries.size;
        },
        key: (index) => [...entries.keys()][index] ?? null,
        getItem: (key) => entries.get(key) ?? null,
        setItem: (key, value) => {
            entries.set(key, value);
        },
        removeItem: (key) => {
            entries.delete(key);
        },
    };
};

const entry = (overrides: Partial<VideoEntry> & Pick<VideoEntry, "path" | "title">): VideoEntry => ({
    sizeBytes: 0,
    modifiedMs: 0,
    ...overrides,
});

describe("isVideoPath", () => {
    it("accepts mp4/webm only, case-insensitively", () => {
        expect(isVideoPath("C:\\Shows\\clip.MP4")).toBe(true);
        expect(isVideoPath("C:/Shows/clip.webm")).toBe(true);
        expect(isVideoPath("C:/Shows/clip.mkv")).toBe(false);
        expect(isVideoPath("C:/Shows/clip.mp4.txt")).toBe(false);
        expect(isVideoPath("")).toBe(false);
    });
});

describe("scanVideoEntries", () => {
    const tree: Tree = {
        "C:/Videos": {
            "root.mp4": file(100, 10),
            "notes.txt": file(),
            Shows: dir(),
            ".cache": dir(),
        },
        "C:/Videos/Shows": {
            "ep2.webm": file(2048, 20),
            "ep10.MP4": file(4096, 30),
            "cover.jpg": file(),
            "Season 1": dir(),
        },
        "C:/Videos/Shows/Season 1": {
            "extra.mp4": file(512, 40),
        },
        "C:/Videos/.cache": {
            "hidden.mp4": file(),
        },
    };

    it("walks nested folders, keeps only videos, and reports stat metadata", async () => {
        const result = await scanVideoEntries(createIo(tree), ["C:/Videos"]);

        expect(result.errors).toEqual([]);
        expect(result.entries).toHaveLength(4);
        expect(result.entries.map((item) => item.path).sort()).toEqual([
            "C:/Videos/Shows/Season 1/extra.mp4",
            "C:/Videos/Shows/ep10.MP4",
            "C:/Videos/Shows/ep2.webm",
            "C:/Videos/root.mp4",
        ]);
        const root = result.entries.find((item) => item.path === "C:/Videos/root.mp4");
        expect(root).toMatchObject({ title: "root", sizeBytes: 100, modifiedMs: 10 });
    });

    it("stops descending at maxDepth", async () => {
        const shallow = await scanVideoEntries(createIo(tree), ["C:/Videos"], { maxDepth: 1 });

        expect(shallow.entries.map((item) => item.path).sort()).toEqual([
            "C:/Videos/Shows/ep10.MP4",
            "C:/Videos/Shows/ep2.webm",
            "C:/Videos/root.mp4",
        ]);
        expect(DEFAULT_SCAN_MAX_DEPTH).toBe(8);
    });

    it("scans all nested folders when maxDepth is Infinity or aborts cleanly", async () => {
        const controller = new AbortController();
        const all = await scanVideoEntries(createIo(tree), ["C:/Videos"], {
            maxDepth: Number.POSITIVE_INFINITY,
            signal: controller.signal,
        });
        expect(all.entries.length).toBeGreaterThan(0);
        expect(all.errors).toEqual([]);

        controller.abort();
        const aborted = await scanVideoEntries(createIo(tree), ["C:/Videos"], {
            maxDepth: Number.POSITIVE_INFINITY,
            signal: controller.signal,
        });
        expect(aborted.entries).toEqual([]);
    });

    it("collects unreadable directories and keeps scanning the rest", async () => {
        const io = createIo(tree);
        const failing: VideoScanIo = {
            ...io,
            readdir: async (directory) => {
                if (directory === "C:/Videos/Shows") throw new Error("EACCES: permission denied");
                return io.readdir(directory);
            },
            stat: async (target) => {
                if (target === "C:/Videos/notes.txt") throw new Error("EPERM");
                return io.stat(target);
            },
        };

        const result = await scanVideoEntries(failing, ["C:/Videos"]);

        expect(result.entries.map((item) => item.path)).toEqual(["C:/Videos/root.mp4"]);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.map((error) => error.path)).toEqual(
            expect.arrayContaining(["C:/Videos/Shows", "C:/Videos/notes.txt"]),
        );
        expect(result.errors.some((error) => error.message.includes("EACCES"))).toBe(true);
    });

    it("deduplicates overlapping roots and repeated paths", async () => {
        const result = await scanVideoEntries(createIo(tree), [
            "C:/Videos",
            "C:/Videos",
            "C:/Videos/Shows",
            "   ",
        ]);

        expect(result.entries).toHaveLength(4);
    });
});

describe("filterAndSortVideos", () => {
    const entries = [
        entry({ path: "C:\\Videos\\Shows\\ep10.mp4", title: "ep10", modifiedMs: 100 }),
        entry({ path: "C:\\Videos\\Shows\\ep2.mp4", title: "ep2", modifiedMs: 300 }),
        entry({ path: "C:\\Videos\\Movies\\Beach.webm", title: "Beach", modifiedMs: 0 }),
        entry({ path: "C:\\Videos\\Shows\\ep1.mp4", title: "ep1", modifiedMs: 200 }),
    ];

    it("matches every term against title and full path", () => {
        const byPath = filterAndSortVideos(entries, { query: "shows mp4", sort: "name" });
        expect(byPath.map((item) => item.title)).toEqual(["ep1", "ep2", "ep10"]);

        const byTitle = filterAndSortVideos(entries, { query: "BEACH", sort: "name" });
        expect(byTitle.map((item) => item.title)).toEqual(["Beach"]);

        expect(filterAndSortVideos(entries, { query: "nothing-here" })).toEqual([]);
    });

    it("sorts by newest first, with unknown timestamps last", () => {
        expect(filterAndSortVideos(entries, { sort: "newest" }).map((item) => item.title)).toEqual([
            "ep2",
            "ep1",
            "ep10",
            "Beach",
        ]);
    });

    it("sorts names naturally and leaves the input untouched", () => {
        const input = [...entries];
        expect(filterAndSortVideos(input, { sort: "name" }).map((item) => item.title)).toEqual([
            "Beach",
            "ep1",
            "ep2",
            "ep10",
        ]);
        expect(input.map((item) => item.title)).toEqual(["ep10", "ep2", "Beach", "ep1"]);
    });
});

describe("formatBytes", () => {
    it("formats byte counts across units", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(-10)).toBe("0 B");
        expect(formatBytes(Number.NaN)).toBe("0 B");
        expect(formatBytes(512)).toBe("512 B");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
        expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.5 GB");
    });
});

describe("formatTime", () => {
    it("formats player clocks and clamps invalid values", () => {
        expect(formatTime(0)).toBe("0:00");
        expect(formatTime(Number.NaN)).toBe("0:00");
        expect(formatTime(-4)).toBe("0:00");
        expect(formatTime(9.9)).toBe("0:09");
        expect(formatTime(75)).toBe("1:15");
        expect(formatTime(3671)).toBe("1:01:11");
    });
});

describe("seekPreviewLeft", () => {
    it("follows the cursor in the middle of the track", () => {
        expect(seekPreviewLeft(0.5, 400, 168)).toBe(200);
        expect(seekPreviewLeft(0.25, 400, 168)).toBe(100);
    });

    it("clamps the card inside the track at both edges", () => {
        const half = 168 / 2 + 4;
        expect(seekPreviewLeft(0, 400, 168)).toBe(half);
        expect(seekPreviewLeft(1, 400, 168)).toBe(400 - half);
        expect(seekPreviewLeft(-3, 400, 168)).toBe(half);
        expect(seekPreviewLeft(7, 400, 168)).toBe(400 - half);
    });

    it("centres the card when the track is narrower than it", () => {
        expect(seekPreviewLeft(0.2, 100, 168)).toBe(50);
        expect(seekPreviewLeft(0.8, 100, 168)).toBe(50);
        expect(seekPreviewLeft(0.5, 0, 168)).toBe(0);
    });
});

describe("resume positions", () => {
    it("writes JSON entries and reads them back newest first", () => {
        const storage = createStorage();
        expect(writeWatchedPosition(storage, "C:/a.mp4", 12.345, 100, 1000)).toBe(true);
        expect(writeWatchedPosition(storage, "C:/b.webm", 42, 300, 2000)).toBe(true);

        expect(storage.entries.get(positionStorageKey("C:/a.mp4"))).toContain('"time":12.35');

        const positions = readWatchedPositions(storage);
        expect(positions).toEqual([
            { path: "C:/b.webm", time: 42, duration: 300, updatedAt: 2000 },
            { path: "C:/a.mp4", time: 12.35, duration: 100, updatedAt: 1000 },
        ]);
        expect(readWatchedPosition(storage, "C:/a.mp4")?.time).toBe(12.35);
    });

    it("accepts legacy plain-number values and ignores malformed entries", () => {
        const storage = createStorage();
        storage.setItem(`${POSITION_KEY_PREFIX}C:/legacy.mp4`, "95.5");
        storage.setItem(`${POSITION_KEY_PREFIX}C:/broken.mp4`, "{not-json");
        storage.setItem(`${POSITION_KEY_PREFIX}C:/zero.mp4`, "0");
        storage.setItem("unrelated-key", "123");

        const positions = readWatchedPositions(storage);
        expect(positions).toEqual([{ path: "C:/legacy.mp4", time: 95.5, duration: 0, updatedAt: 0 }]);
    });

    it("clears positions near the end and ignores unusable times", () => {
        const storage = createStorage();
        expect(writeWatchedPosition(storage, "C:/a.mp4", 100, 100)).toBe(false);
        expect(storage.entries.size).toBe(0);

        expect(writeWatchedPosition(storage, "C:/a.mp4", 0, 100)).toBe(false);
        expect(writeWatchedPosition(storage, "   ", 10, 100)).toBe(false);
        expect(writeWatchedPosition(storage, "C:/a.mp4", Number.NaN, 100)).toBe(false);

        expect(writeWatchedPosition(storage, "C:/a.mp4", 50, 100)).toBe(true);
        expect(storage.entries.size).toBe(1);

        expect(writeWatchedPosition(storage, "C:/a.mp4", 98, 100)).toBe(false);
        expect(storage.entries.size).toBe(0);
    });

    it("removes a single stored position", () => {
        const storage = createStorage();
        writeWatchedPosition(storage, "C:/a.mp4", 10, 100);
        writeWatchedPosition(storage, "C:/b.mp4", 10, 100);

        removeWatchedPosition(storage, "C:/a.mp4");

        expect(readWatchedPositions(storage).map((item) => item.path)).toEqual(["C:/b.mp4"]);
    });

    it("survives a storage implementation that throws", () => {
        const broken: MediaPositionStorage = {
            get length(): number {
                throw new Error("denied");
            },
            key: () => null,
            getItem: () => {
                throw new Error("denied");
            },
            setItem: () => {
                throw new Error("denied");
            },
            removeItem: () => {
                throw new Error("denied");
            },
        };

        expect(readWatchedPositions(broken)).toEqual([]);
        expect(readWatchedPosition(broken, "C:/a.mp4")).toBeNull();
        expect(writeWatchedPosition(broken, "C:/a.mp4", 10, 100)).toBe(false);
        expect(() => removeWatchedPosition(broken, "C:/a.mp4")).not.toThrow();
    });
});

describe("continueWatchingVideos", () => {
    const entries = [
        entry({ path: "C:\\Videos\\a.mp4", title: "a", modifiedMs: 10 }),
        entry({ path: "C:\\Videos\\b.webm", title: "b", modifiedMs: 20 }),
    ];

    it("joins positions to files, skips missing/finished entries, and caps the list", () => {
        const positions = [
            { path: "C:/Videos/b.webm", time: 20, duration: 100, updatedAt: 300 },
            { path: "C:/Videos/a.mp4", time: 5, duration: 100, updatedAt: 500 },
            { path: "C:/Videos/gone.mp4", time: 5, duration: 100, updatedAt: 600 },
            { path: "C:/Videos/a.mp4", time: 6, duration: 100, updatedAt: 400 },
            { path: "C:/Videos/b.webm", time: 99, duration: 100, updatedAt: 700 },
        ];

        const items = continueWatchingVideos(entries, positions, 5);

        expect(items.map((item) => item.entry.title)).toEqual(["a", "b"]);
        expect(items[0]?.position.time).toBe(5);
        expect(continueWatchingVideos(entries, positions, 1)).toHaveLength(1);
        expect(continueWatchingVideos(entries, positions, 0)).toEqual([]);
    });
});
