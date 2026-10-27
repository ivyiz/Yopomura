import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appendTrashEntry } from "./journal";
import {
    emptyTrash,
    getTrashStats,
    listActiveTrash,
    measureTrashPathSize,
    moveToTrash,
    resolveRecoveryPath,
    restoreAllTrash,
    setTrashRetention,
} from "./trashService";

const DAY_MS = 24 * 60 * 60 * 1000;

const { tmpUserData } = vi.hoisted(() => {
    const fsHoisted = require("node:fs") as typeof import("node:fs");
    const osHoisted = require("node:os") as typeof import("node:os");
    const pathHoisted = require("node:path") as typeof import("node:path");
    const tmp = fsHoisted.mkdtempSync(pathHoisted.join(osHoisted.tmpdir(), "yomikiru-trash-service-"));
    return { tmpUserData: tmp };
});

vi.mock("electron", () => ({
    app: {
        getPath: (name: string) => (name === "userData" ? tmpUserData : path.join(tmpUserData, name)),
    },
    shell: {
        openPath: vi.fn(async () => ""),
    },
}));

const tempDirs: string[] = [];

const makeTempDir = (prefix: string): string => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
};

const makeFile = (dir: string, name: string, bytes: number): string => {
    const filePath = path.join(dir, name);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.alloc(bytes, 1));
    return filePath;
};

const existsIn =
    (...taken: string[]) =>
    async (candidate: string): Promise<boolean> =>
        taken.map((row) => path.normalize(row)).includes(path.normalize(candidate));

afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(tmpUserData, "trash"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpUserData, "trash-journal.json"), { force: true });
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
});

describe("resolveRecoveryPath", () => {
    it("uses the original path when it is free", async () => {
        const original = path.join("C:\\library", "One Piece.zip");
        await expect(resolveRecoveryPath(original, "file", existsIn())).resolves.toBe(original);
    });

    it("keeps both files with a (recovered) suffix", async () => {
        const original = path.join("C:\\library", "One Piece.zip");
        const first = path.join("C:\\library", "One Piece (recovered).zip");
        const second = path.join("C:\\library", "One Piece (recovered 2).zip");

        await expect(resolveRecoveryPath(original, "file", existsIn(original))).resolves.toBe(first);
        await expect(resolveRecoveryPath(original, "file", existsIn(original, first))).resolves.toBe(second);
    });

    it("suffixes folders without an extension", async () => {
        const original = path.join("C:\\library", "Chapter 01");
        await expect(resolveRecoveryPath(original, "folder", existsIn(original))).resolves.toBe(
            path.join("C:\\library", "Chapter 01 (recovered)"),
        );
    });
});

describe("measureTrashPathSize", () => {
    it("sums nested file sizes and skips missing or pruned paths", async () => {
        const root = makeTempDir("yomikiru-trash-size-");
        makeFile(root, "one.bin", 100);
        makeFile(root, path.join("a", "two.bin"), 250);
        makeFile(root, path.join("a", "b", "three.bin"), 3);

        await expect(measureTrashPathSize(root)).resolves.toBe(353);
        await expect(measureTrashPathSize(path.join(root, "missing"))).resolves.toBe(0);
        await expect(measureTrashPathSize(root, { maxDepth: 0 })).resolves.toBe(0);
        await expect(measureTrashPathSize(path.join(root, "one.bin"))).resolves.toBe(100);
    });
});

describe("trash statistics", () => {
    it("counts active entries and sums their recursive on-disk size", async () => {
        const source = makeTempDir("yomikiru-trash-stats-source-");
        const folder = path.join(source, "Series");
        makeFile(folder, "chapter-01.cbz", 10);
        makeFile(folder, path.join("extras", "chapter-02.cbz"), 20);
        await moveToTrash({ path: folder, retentionDays: 7 });

        const file = makeFile(source, "One Piece.cbz", 5);
        await moveToTrash({ path: file });

        await appendTrashEntry({
            originalPath: path.join(source, "legacy.cbz"),
            kind: "file",
        });

        await expect(getTrashStats()).resolves.toEqual({ count: 3, totalBytes: 35 });
    });
});

describe("setTrashRetention", () => {
    it("recomputes the expiry from deletedAt for app entries", async () => {
        const source = makeTempDir("yomikiru-trash-retention-");
        const file = makeFile(source, "volume-01.cbz", 4);
        const entry = await moveToTrash({ path: file, retentionDays: 7 });

        const updated = await setTrashRetention(entry.id, 3);
        expect(updated.ok).toBe(true);
        if (!updated.ok) throw new Error(updated.message);
        expect(updated.entry.id).toBe(entry.id);
        expect(updated.entry.retentionDays).toBe(3);
        expect(updated.entry.expiresAt).toBe(entry.deletedAt + 3 * DAY_MS);

        const [listed] = await listActiveTrash();
        expect(listed?.expiresAt).toBe(entry.deletedAt + 3 * DAY_MS);
    });

    it("rejects invalid windows, unknown ids and legacy rows", async () => {
        const source = makeTempDir("yomikiru-trash-retention-reject-");
        const file = makeFile(source, "volume-02.cbz", 4);
        const entry = await moveToTrash({ path: file });

        await expect(setTrashRetention(entry.id, 4)).resolves.toMatchObject({ ok: false });
        await expect(setTrashRetention(entry.id, 0)).resolves.toMatchObject({ ok: false });
        await expect(setTrashRetention("missing-id", 7)).resolves.toMatchObject({ ok: false });

        const legacy = await appendTrashEntry({
            originalPath: path.join(source, "legacy.cbz"),
            kind: "file",
        });
        const legacyResult = await setTrashRetention(legacy.id, 1);
        expect(legacyResult.ok).toBe(false);
        if (legacyResult.ok) return;
        expect(legacyResult.message).toContain("Recycle Bin");
    });
});

describe("emptyTrash", () => {
    it("purges every active app entry and leaves legacy rows", async () => {
        const source = makeTempDir("yomikiru-trash-empty-");
        const first = await moveToTrash({ path: makeFile(source, "first.cbz", 8) });
        const second = await moveToTrash({ path: makeFile(source, "second.cbz", 8) });
        const legacy = await appendTrashEntry({
            originalPath: path.join(source, "legacy.cbz"),
            kind: "file",
        });

        await expect(emptyTrash()).resolves.toEqual({ ok: true, count: 2 });

        const remaining = await listActiveTrash();
        expect(remaining.map((entry) => entry.id)).toEqual([legacy.id]);
        if (first.trashPath) expect(fs.existsSync(path.dirname(first.trashPath))).toBe(false);
        if (second.trashPath) expect(fs.existsSync(path.dirname(second.trashPath))).toBe(false);
        await expect(getTrashStats()).resolves.toEqual({ count: 1, totalBytes: 0 });
    });

    it("returns count zero when only legacy rows are pending", async () => {
        const source = makeTempDir("yomikiru-trash-empty-legacy-");
        await appendTrashEntry({ originalPath: path.join(source, "legacy.cbz"), kind: "file" });
        await expect(emptyTrash()).resolves.toEqual({ ok: true, count: 0 });
    });
});

describe("restoreAllTrash", () => {
    it("recovers every entry and keeps both files on collisions", async () => {
        const source = makeTempDir("yomikiru-trash-restore-all-");
        const collided = makeFile(source, "One Piece.cbz", 6);
        await moveToTrash({ path: collided });
        fs.writeFileSync(collided, Buffer.alloc(3, 9));
        const plain = makeFile(source, "Berserk.cbz", 9);
        await moveToTrash({ path: plain });

        await expect(restoreAllTrash()).resolves.toEqual({ ok: true, count: 2, failed: 0 });

        expect(fs.readFileSync(collided)).toHaveLength(3);
        expect(fs.readFileSync(path.join(source, "One Piece (recovered).cbz"))).toHaveLength(6);
        expect(fs.readFileSync(plain)).toHaveLength(9);
        await expect(listActiveTrash()).resolves.toEqual([]);
        await expect(getTrashStats()).resolves.toEqual({ count: 0, totalBytes: 0 });
    });

    it("continues past entries whose trash copy is missing", async () => {
        const source = makeTempDir("yomikiru-trash-restore-fail-");
        const broken = await moveToTrash({ path: makeFile(source, "broken.cbz", 2) });
        await moveToTrash({ path: makeFile(source, "healthy.cbz", 2) });
        if (broken.trashPath) fs.rmSync(broken.trashPath, { force: true });

        await expect(restoreAllTrash()).resolves.toEqual({ ok: true, count: 1, failed: 1 });
        expect(fs.existsSync(path.join(source, "healthy.cbz"))).toBe(true);
        await expect(listActiveTrash()).resolves.toHaveLength(1);
    });

    it("reports an error when nothing can be recovered", async () => {
        const source = makeTempDir("yomikiru-trash-restore-none-");
        const broken = await moveToTrash({ path: makeFile(source, "only.cbz", 2) });
        if (broken.trashPath) fs.rmSync(broken.trashPath, { force: true });

        const result = await restoreAllTrash();
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.message).toContain("missing");
    });
});
