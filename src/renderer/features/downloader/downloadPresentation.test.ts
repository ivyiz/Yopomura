import { describe, expect, it } from "vitest";
import type { DownloadFeedRow } from "./downloadFeed";
import { downloadFileKind, downloadProgressPercent, formatDownloadMeta } from "./downloadPresentation";

const row = (overrides: Partial<DownloadFeedRow> = {}): DownloadFeedRow => ({
    key: "browser:1",
    id: "1",
    source: "browser",
    title: "file.bin",
    url: "https://example.com/file.bin",
    path: "C:\\Downloads\\file.bin",
    status: "done",
    received: 147 * 1024,
    total: 147 * 1024,
    finishedAt: 1000,
    ...overrides,
});

describe("download presentation", () => {
    it("classifies extensions for the file icon", () => {
        expect(downloadFileKind("clip.MP4")).toBe("video");
        expect(downloadFileKind("archive.cbz?token=1")).toBe("archive");
        expect(downloadFileKind("cover.webp")).toBe("image");
        expect(downloadFileKind("page.html")).toBe("document");
        expect(downloadFileKind("setup.exe")).toBe("executable");
        expect(downloadFileKind("no-extension")).toBe("other");
    });

    it("shows received/total and percent while downloading", () => {
        const active = row({
            status: "progressing",
            received: 2.5 * 1024 * 1024,
            total: 5 * 1024 * 1024,
            finishedAt: null,
        });

        expect(downloadProgressPercent(active)).toBe(50);
        expect(formatDownloadMeta(active)).toBe("2.5 MB/5.0 MB · 50%");
    });

    it("falls back to received bytes when Content-Length is missing", () => {
        const active = row({ status: "progressing", received: 2048, total: 0, finishedAt: null });

        expect(downloadProgressPercent(active)).toBeNull();
        expect(formatDownloadMeta(active)).toBe("2.0 KB · Downloading…");
    });

    it("shows size and relative time for completed downloads", () => {
        const finished = row({ finishedAt: new Date("2026-01-01T00:00:00.000Z").getTime() });

        expect(formatDownloadMeta(finished, new Date("2026-01-01T02:00:00.000Z").getTime())).toContain("147 KB");
        expect(formatDownloadMeta(finished, new Date("2026-01-01T02:00:00.000Z").getTime())).toContain("ago");
        expect(formatDownloadMeta(finished)).not.toContain("Done");
    });

    it("adds a failure label before the relative time", () => {
        const failed = row({ status: "error", received: 0 });

        expect(formatDownloadMeta(failed)).toContain("Failed");
    });
});
