import { describe, expect, it, vi } from "vitest";
import {
    addRecentFolder,
    addRecentVideo,
    clearRecentFolders,
    clearRecentVideos,
    MAX_RECENT_FOLDERS,
    MAX_RECENT_VIDEOS,
    MEDIA_RECENTS_EVENT,
    RECENT_FOLDERS_KEY,
    RECENT_VIDEOS_KEY,
    readRecentFolders,
    readRecentVideos,
} from "./mediaRecents";

const makeStorage = (initial?: Record<string, string>) => {
    const values = new Map<string, string>(Object.entries(initial ?? {}));
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        values,
    };
};

describe("media recents", () => {
    it("records opened videos newest first and dedupes Windows paths", () => {
        const storage = makeStorage();
        addRecentVideo("C:\\Shows\\Ep1.MP4", "Ep 1", 100, storage);
        addRecentVideo("C:\\Shows\\Ep2.mp4", "Ep 2", 200, storage);
        addRecentVideo("c:/shows/ep1.mp4", "Ep 1 again", 300, storage);

        expect(readRecentVideos(storage)).toEqual([
            { path: "c:/shows/ep1.mp4", title: "Ep 1 again", openedAt: 300 },
            { path: "C:\\Shows\\Ep2.mp4", title: "Ep 2", openedAt: 200 },
        ]);
    });

    it("derives a title when none is supplied and caps the list", () => {
        const storage = makeStorage();
        for (let index = 0; index < MAX_RECENT_VIDEOS + 5; index += 1) {
            addRecentVideo(`C:\\Shows\\clip-${index}.webm`, "", index, storage);
        }
        const rows = readRecentVideos(storage);
        expect(rows).toHaveLength(MAX_RECENT_VIDEOS);
        expect(rows[0]?.title).toBe(`clip-${MAX_RECENT_VIDEOS + 4}`);
    });

    it("records folders newest first, ignoring trailing separators", () => {
        const storage = makeStorage();
        addRecentFolder("C:\\Shows\\Anime", 100, storage);
        addRecentFolder("C:\\Shows\\Movies", 200, storage);
        addRecentFolder("c:/shows/anime/", 300, storage);

        expect(readRecentFolders(storage)).toEqual([
            { path: "c:/shows/anime/", openedAt: 300 },
            { path: "C:\\Shows\\Movies", openedAt: 200 },
        ]);
    });

    it("caps folders and ignores corrupt storage", () => {
        const storage = makeStorage();
        for (let index = 0; index < MAX_RECENT_FOLDERS + 3; index += 1) {
            addRecentFolder(`C:\\Shows\\Folder ${index}`, index, storage);
        }
        expect(readRecentFolders(storage)).toHaveLength(MAX_RECENT_FOLDERS);

        expect(readRecentVideos(makeStorage({ [RECENT_VIDEOS_KEY]: "{not json" }))).toEqual([]);
        expect(readRecentFolders(makeStorage({ [RECENT_FOLDERS_KEY]: '{"path":"x"}' }))).toEqual([]);
    });

    it("clears histories and notifies listeners", () => {
        const storage = makeStorage();
        addRecentVideo("C:\\Shows\\Ep1.mp4", "Ep 1", 100, storage);
        addRecentFolder("C:\\Shows", 100, storage);
        const listener = vi.fn();
        window.addEventListener(MEDIA_RECENTS_EVENT, listener);
        try {
            clearRecentVideos(storage);
            clearRecentFolders(storage);
        } finally {
            window.removeEventListener(MEDIA_RECENTS_EVENT, listener);
        }

        expect(readRecentVideos(storage)).toEqual([]);
        expect(readRecentFolders(storage)).toEqual([]);
        expect(listener).toHaveBeenCalledTimes(2);
    });
});
