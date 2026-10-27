import { describe, expect, it } from "vitest";
import {
    buildVideoPlaylist,
    filterVideoItems,
    findVideoIndex,
    isVideoPath,
    nextVideo,
    normalizeVideoPath,
    prevVideo,
    sortVideoItems,
    VIDEO_EXTENSIONS,
    videoTitleFromPath,
} from "./playlist";

const entry = (path: string, title = "") => ({ path, title });

describe("playlist helpers", () => {
    it("supports only mp4 and webm containers", () => {
        expect(VIDEO_EXTENSIONS).toEqual([".mp4", ".webm"]);
        expect(isVideoPath("C:\\Shows\\clip.MP4")).toBe(true);
        expect(isVideoPath("C:/Shows/clip.webm")).toBe(true);
        expect(isVideoPath("C:/Shows/clip.mkv")).toBe(false);
        expect(isVideoPath("C:/Shows/clip.mp4.txt")).toBe(false);
        expect(isVideoPath("")).toBe(false);
    });

    it("filters non-video entries without reordering the rest", () => {
        const items = [entry("a.mp4"), entry("notes.txt"), entry("b.webm"), entry("cover.jpg")];

        expect(filterVideoItems(items).map((item) => item.path)).toEqual(["a.mp4", "b.webm"]);
        expect(items.map((item) => item.path)).toEqual(["a.mp4", "notes.txt", "b.webm", "cover.jpg"]);
    });

    it("sorts paths naturally and leaves the input array untouched", () => {
        const items = [entry("ep10.mp4"), entry("ep2.mp4"), entry("ep1.mp4")];
        const sorted = sortVideoItems(items);

        expect(sorted.map((item) => item.path)).toEqual(["ep1.mp4", "ep2.mp4", "ep10.mp4"]);
        expect(items.map((item) => item.path)).toEqual(["ep10.mp4", "ep2.mp4", "ep1.mp4"]);
    });

    it("builds a filtered, naturally sorted playlist with filename title fallback", () => {
        const playlist = buildVideoPlaylist([
            entry("C:\\Shows\\ep10.mp4"),
            entry("C:\\Shows\\ep2.mp4", "  Two  "),
            entry("C:\\Shows\\notes.txt", "Notes"),
            entry("C:\\Shows\\ep1.mp4", ""),
        ]);

        expect(playlist).toEqual([
            { path: "C:\\Shows\\ep1.mp4", title: "ep1" },
            { path: "C:\\Shows\\ep2.mp4", title: "Two" },
            { path: "C:\\Shows\\ep10.mp4", title: "ep10" },
        ]);
    });

    it("deduplicates paths that differ only by separators or case", () => {
        const playlist = buildVideoPlaylist([
            entry("C:\\Shows\\Ep1.mp4", "first"),
            entry("c:/shows/ep1.MP4", "second"),
        ]);

        const [first] = playlist;
        expect(playlist).toHaveLength(1);
        expect(first).toBeDefined();
        expect(normalizeVideoPath(first?.path ?? "")).toBe("c:/shows/ep1.mp4");
        expect(first?.title).toBe("first");
    });

    it("keeps the first title when the exact same path is listed twice", () => {
        const playlist = buildVideoPlaylist([entry("a.mp4", "First"), entry("a.mp4", "Second")]);

        expect(playlist).toEqual([{ path: "a.mp4", title: "First" }]);
    });

    it("returns an empty playlist when nothing is playable", () => {
        expect(buildVideoPlaylist([])).toEqual([]);
        expect(buildVideoPlaylist([entry("notes.txt"), entry("cover.jpg")])).toEqual([]);
    });

    it("normalizes Windows paths for comparisons", () => {
        expect(normalizeVideoPath("  C:\\Shows\\Clip.MP4  ")).toBe("c:/shows/clip.mp4");
    });

    it("derives a display title from the filename", () => {
        expect(videoTitleFromPath("C:\\Shows\\My.Show.S01E01.mp4")).toBe("My.Show.S01E01");
        expect(videoTitleFromPath("/media/shows/ep1.webm")).toBe("ep1");
        expect(videoTitleFromPath("C:\\Shows\\no-extension")).toBe("no-extension");
    });

    it("finds an entry by normalized path", () => {
        const playlist = [entry("C:\\Shows\\ep1.mp4"), entry("C:\\Shows\\ep2.mp4")];

        expect(findVideoIndex(playlist, "c:/shows/EP2.MP4")).toBe(1);
        expect(findVideoIndex(playlist, "C:\\Shows\\missing.mp4")).toBe(-1);
    });

    it("steps forward and wraps from the last entry to the first", () => {
        const playlist = [entry("a.mp4"), entry("b.mp4"), entry("c.mp4")];

        expect(nextVideo(playlist, "a.mp4")?.path).toBe("b.mp4");
        expect(nextVideo(playlist, "b.mp4")?.path).toBe("c.mp4");
        expect(nextVideo(playlist, "c.mp4")?.path).toBe("a.mp4");
    });

    it("steps backward and wraps from the first entry to the last", () => {
        const playlist = [entry("a.mp4"), entry("b.mp4"), entry("c.mp4")];

        expect(prevVideo(playlist, "a.mp4")?.path).toBe("c.mp4");
        expect(prevVideo(playlist, "b.mp4")?.path).toBe("a.mp4");
        expect(prevVideo(playlist, "c.mp4")?.path).toBe("b.mp4");
    });

    it("starts at the edge when the current path is unknown", () => {
        const playlist = [entry("a.mp4"), entry("b.mp4"), entry("c.mp4")];

        expect(nextVideo(playlist, "unknown.mp4")?.path).toBe("a.mp4");
        expect(prevVideo(playlist, "unknown.mp4")?.path).toBe("c.mp4");
    });

    it("handles empty and single-entry playlists", () => {
        expect(nextVideo([], "a.mp4")).toBeNull();
        expect(prevVideo([], "a.mp4")).toBeNull();

        const single = [entry("only.mp4")];
        expect(nextVideo(single, "only.mp4")?.path).toBe("only.mp4");
        expect(prevVideo(single, "only.mp4")?.path).toBe("only.mp4");
    });
});
