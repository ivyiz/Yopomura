import type { BrowserDownload } from "@common/types/browser";
import { describe, expect, it } from "vitest";
import { buildDownloadFeed, type DownloadFeedRow, MAX_DOWNLOAD_FEED_ROWS } from "./downloadFeed";
import type { DownloadHistoryEntry } from "./downloadHistory";

const browserDownload = (overrides: Partial<BrowserDownload> = {}): BrowserDownload => ({
    id: "1",
    filename: "clip.mp4",
    state: "progressing",
    received: 50,
    total: 100,
    savePath: "C:\\Downloads\\clip.mp4",
    url: "https://example.com/clip.mp4",
    ...overrides,
});

const historyEntry = (overrides: Partial<DownloadHistoryEntry> = {}): DownloadHistoryEntry => ({
    id: "job-1",
    source: "downloader",
    title: "Manga",
    url: "https://example.com/manga",
    path: "C:\\Downloads\\Manga.zip",
    status: "done",
    bytes: 2048,
    finishedAt: 1000,
    ...overrides,
});

const titles = (rows: DownloadFeedRow[]) => rows.map((row) => row.title);

describe("download feed", () => {
    it("puts active browser downloads above finished history", () => {
        const rows = buildDownloadFeed(
            [browserDownload()],
            [
                historyEntry({ id: "a", title: "Older", finishedAt: 200 }),
                historyEntry({ id: "b", title: "Newer", finishedAt: 300 }),
            ],
        );

        expect(titles(rows)).toEqual(["clip.mp4", "Newer", "Older"]);
        expect(rows[0].status).toBe("progressing");
    });

    it("keeps the history row for a finished browser download instead of duplicating it", () => {
        const rows = buildDownloadFeed(
            [browserDownload({ state: "completed", received: 100 })],
            [
                historyEntry({
                    id: "1",
                    source: "browser",
                    title: "clip.mp4",
                    status: "done",
                    bytes: 100,
                    finishedAt: 1234,
                }),
            ],
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].source).toBe("browser");
        expect(rows[0].finishedAt).toBe(1234);
    });

    it("adds a just-finished browser download when history has not caught up", () => {
        const rows = buildDownloadFeed([browserDownload({ state: "completed" })], [], 5000);

        expect(rows[0]).toMatchObject({ title: "clip.mp4", status: "done", finishedAt: 5000 });
    });

    it("shows the numbered saved filename for duplicate browser downloads", () => {
        const rows = buildDownloadFeed(
            [],
            [
                historyEntry({
                    id: "x",
                    source: "browser",
                    title: "browser-manga.cbz",
                    path: "C:\\Downloads\\browser-manga (1).cbz",
                }),
            ],
        );

        expect(rows[0].title).toBe("browser-manga (1).cbz");
    });

    it("maps cancelled and interrupted states into feed statuses", () => {
        const rows = buildDownloadFeed(
            [
                browserDownload({ id: "1", state: "cancelled", filename: "cancelled.zip" }),
                browserDownload({ id: "2", state: "interrupted", filename: "interrupted.zip" }),
            ],
            [],
        );

        expect(rows.map((row) => row.status)).toEqual(["cancelled", "interrupted"]);
    });

    it("keeps the feed compact", () => {
        const history = Array.from({ length: MAX_DOWNLOAD_FEED_ROWS + 5 }, (_, index) =>
            historyEntry({ id: `job-${index}`, title: `Job ${index}`, finishedAt: index }),
        );
        const rows = buildDownloadFeed([], history);

        expect(rows).toHaveLength(MAX_DOWNLOAD_FEED_ROWS);
        expect(rows[0].title).toBe(`Job ${MAX_DOWNLOAD_FEED_ROWS + 4}`);
    });
});
