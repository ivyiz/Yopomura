import type { BrowserDownload } from "@common/types/browser";
import type { DownloadHistoryEntry, DownloadHistoryStatus } from "./downloadHistory";

/** One row in the browser's Recent Download History bubble. */
export type DownloadFeedStatus = "progressing" | "done" | "error" | "cancelled" | "interrupted";

export type DownloadFeedRow = {
    key: string;
    id: string;
    source: "browser" | "downloader";
    title: string;
    url: string;
    path: string;
    status: DownloadFeedStatus;
    received: number;
    total: number;
    finishedAt: number | null;
};

/** Keep the bubble compact; the full list lives in Download History. */
export const MAX_DOWNLOAD_FEED_ROWS = 12;

const fileNameOf = (path: string): string => path.split(/[\\/]/).pop() || "";

const browserStatus = (state: BrowserDownload["state"]): DownloadFeedStatus => {
    if (state === "completed") return "done";
    return state;
};

const historyStatus = (status: DownloadHistoryStatus): DownloadFeedStatus => status;

/**
 * Merges live browser downloads with the persisted browser/downloader history.
 * A live progressing row wins over its old history row; finished browser rows
 * defer to history so their real completion time is kept.
 */
export const buildDownloadFeed = (
    browserDownloads: readonly BrowserDownload[],
    history: readonly DownloadHistoryEntry[],
    now: number = Date.now(),
): DownloadFeedRow[] => {
    const rows = new Map<string, DownloadFeedRow>();

    for (const entry of history) {
        const key = `${entry.source}:${entry.id}`;
        const savedName = entry.source === "browser" ? fileNameOf(entry.path) : "";
        rows.set(key, {
            key,
            id: entry.id,
            source: entry.source,
            title: savedName || entry.title || entry.url,
            url: entry.url,
            path: entry.path,
            status: historyStatus(entry.status),
            received: entry.bytes,
            total: entry.bytes,
            finishedAt: entry.finishedAt,
        });
    }

    for (const download of browserDownloads) {
        const key = `browser:${download.id}`;
        const live = download.state === "progressing";
        if (!live && rows.has(key)) continue;
        rows.set(key, {
            key,
            id: download.id,
            source: "browser",
            title: fileNameOf(download.savePath) || download.filename,
            url: download.url,
            path: download.savePath,
            status: browserStatus(download.state),
            received: download.received,
            total: download.total,
            finishedAt: live ? null : now,
        });
    }

    return [...rows.values()]
        .sort((left, right) => {
            const leftActive = left.status === "progressing";
            const rightActive = right.status === "progressing";
            if (leftActive !== rightActive) return leftActive ? -1 : 1;
            return (right.finishedAt ?? 0) - (left.finishedAt ?? 0);
        })
        .slice(0, MAX_DOWNLOAD_FEED_ROWS);
};
