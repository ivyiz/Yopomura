import { describe, expect, it } from "vitest";
import {
    addDownloadHistory,
    clearDownloadHistory,
    DOWNLOAD_HISTORY_KEY,
    type DownloadHistoryEntry,
    MAX_DOWNLOAD_HISTORY,
    readDownloadHistory,
    removeDownloadHistory,
} from "./downloadHistory";

const makeStorage = (initial?: string) => {
    const values = new Map<string, string>();
    if (initial !== undefined) values.set(DOWNLOAD_HISTORY_KEY, initial);
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        values,
    };
};

const entry = (overrides: Partial<DownloadHistoryEntry> = {}): DownloadHistoryEntry => ({
    id: "job-1",
    source: "downloader",
    title: "One",
    url: "https://example.com/one",
    path: "C:\\Downloads\\One.zip",
    status: "done",
    bytes: 100,
    finishedAt: 1,
    ...overrides,
});

describe("download history", () => {
    it("keeps entries newest first", () => {
        const storage = makeStorage();
        addDownloadHistory(entry({ id: "a", finishedAt: 100 }), storage);
        addDownloadHistory(entry({ id: "b", finishedAt: 300 }), storage);
        addDownloadHistory(entry({ id: "c", finishedAt: 200 }), storage);

        expect(readDownloadHistory(storage).map((row) => row.id)).toEqual(["b", "c", "a"]);
    });

    it("replaces an entry with the same source and id", () => {
        const storage = makeStorage();
        addDownloadHistory(entry({ id: "job-1", status: "error", finishedAt: 100 }), storage);
        addDownloadHistory(entry({ id: "job-1", status: "done", bytes: 500, finishedAt: 200 }), storage);

        expect(readDownloadHistory(storage)).toEqual([
            expect.objectContaining({ id: "job-1", status: "done", bytes: 500 }),
        ]);
    });

    it("keeps browser and downloader entries apart even when ids match", () => {
        const storage = makeStorage();
        addDownloadHistory(entry({ id: "x", source: "downloader", finishedAt: 100 }), storage);
        addDownloadHistory(entry({ id: "x", source: "browser", finishedAt: 200 }), storage);

        expect(readDownloadHistory(storage).map((row) => row.source)).toEqual(["browser", "downloader"]);
    });

    it("caps the list at the history limit", () => {
        const storage = makeStorage();
        for (let index = 0; index < MAX_DOWNLOAD_HISTORY + 25; index++) {
            addDownloadHistory(entry({ id: `job-${index}`, title: `Job ${index}`, finishedAt: index }), storage);
        }

        const history = readDownloadHistory(storage);
        expect(history).toHaveLength(MAX_DOWNLOAD_HISTORY);
        expect(history[0].id).toBe(`job-${MAX_DOWNLOAD_HISTORY + 24}`);
    });

    it("removes one entry and clears all entries", () => {
        const storage = makeStorage();
        addDownloadHistory(entry({ id: "a", finishedAt: 100 }), storage);
        addDownloadHistory(entry({ id: "b", finishedAt: 200 }), storage);

        expect(removeDownloadHistory("a", "downloader", storage).map((row) => row.id)).toEqual(["b"]);
        clearDownloadHistory(storage);
        expect(readDownloadHistory(storage)).toEqual([]);
    });

    it("ignores corrupt or wrongly shaped storage", () => {
        expect(readDownloadHistory(makeStorage("{not json"))).toEqual([]);
        expect(readDownloadHistory(makeStorage('{"id":"x"}'))).toEqual([]);
        expect(
            readDownloadHistory(
                makeStorage(
                    JSON.stringify([
                        { id: "bad", source: "unknown", url: "https://x", finishedAt: 1 },
                        entry({ id: "good", finishedAt: 2 }),
                    ]),
                ),
            ).map((row) => row.id),
        ).toEqual(["good"]);
    });
});
