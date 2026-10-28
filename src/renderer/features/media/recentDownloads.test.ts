import { describe, expect, it, vi } from "vitest";
import {
    addRecentDownload,
    clearRecentDownloads,
    MAX_RECENT_DOWNLOADS,
    RECENT_DOWNLOADS_EVENT,
    RECENT_DOWNLOADS_KEY,
    readRecentDownloads,
} from "./recentDownloads";

const makeStorage = (initial?: string) => {
    const values = new Map<string, string>();
    if (initial !== undefined) values.set(RECENT_DOWNLOADS_KEY, initial);
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        values,
    };
};

describe("recent browser downloads", () => {
    it("adds video paths newest first and ignores non-video files", () => {
        const storage = makeStorage();
        addRecentDownload("C:\\Downloads\\one.webm", 100, storage);
        addRecentDownload("C:\\Downloads\\cover.jpg", 200, storage);
        addRecentDownload("C:\\Downloads\\two.mp4", 300, storage);

        expect(readRecentDownloads(storage)).toEqual([
            { path: "C:\\Downloads\\two.mp4", downloadedAt: 300 },
            { path: "C:\\Downloads\\one.webm", downloadedAt: 100 },
        ]);
    });

    it("dedupes Windows paths case-insensitively and moves the newest to the top", () => {
        const storage = makeStorage();
        addRecentDownload("C:\\Shows\\Ep1.MP4", 100, storage);
        addRecentDownload("c:/shows/ep1.mp4", 200, storage);

        expect(readRecentDownloads(storage)).toEqual([{ path: "c:/shows/ep1.mp4", downloadedAt: 200 }]);
    });

    it("caps the playlist and ignores corrupt storage", () => {
        const storage = makeStorage();
        for (let index = 0; index < MAX_RECENT_DOWNLOADS + 5; index += 1) {
            addRecentDownload(`C:\\Downloads\\clip-${index}.webm`, index, storage);
        }
        expect(readRecentDownloads(storage)).toHaveLength(MAX_RECENT_DOWNLOADS);
        expect(readRecentDownloads(makeStorage("{not json"))).toEqual([]);
        expect(readRecentDownloads(makeStorage('{"path":"a.webm"}'))).toEqual([]);
    });

    it("clears the playlist and notifies listeners", () => {
        const storage = makeStorage();
        addRecentDownload("C:\\Downloads\\clip.webm", 100, storage);
        const listener = vi.fn();
        window.addEventListener(RECENT_DOWNLOADS_EVENT, listener);
        try {
            clearRecentDownloads(storage);
        } finally {
            window.removeEventListener(RECENT_DOWNLOADS_EVENT, listener);
        }

        expect(readRecentDownloads(storage)).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it("keeps writes non-fatal when storage is unavailable", () => {
        const storage = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        };
        expect(readRecentDownloads(storage)).toEqual([]);
        expect(() => addRecentDownload("C:\\clip.webm", 1, storage)).not.toThrow();
        expect(() => clearRecentDownloads(storage)).not.toThrow();
    });
});
