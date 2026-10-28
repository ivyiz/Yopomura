import { useEffect } from "react";

export type DownloadHistoryStatus = "done" | "error" | "cancelled" | "interrupted";

export type DownloadHistoryEntry = {
    id: string;
    source: "downloader" | "browser";
    title: string;
    url: string;
    path: string;
    status: DownloadHistoryStatus;
    bytes: number;
    finishedAt: number;
    message?: string;
};

export const DOWNLOAD_HISTORY_KEY = "yokomura-download-history";
export const DOWNLOAD_HISTORY_EVENT = "yokomura-download-history-changed";
export const MAX_DOWNLOAD_HISTORY = 200;

type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

const isEntry = (value: unknown): value is DownloadHistoryEntry => {
    if (!value || typeof value !== "object") return false;
    const row = value as Partial<DownloadHistoryEntry>;
    return (
        typeof row.id === "string" &&
        (row.source === "downloader" || row.source === "browser") &&
        typeof row.url === "string" &&
        typeof row.finishedAt === "number"
    );
};

const normalize = (rows: readonly DownloadHistoryEntry[]): DownloadHistoryEntry[] => {
    const unique: DownloadHistoryEntry[] = [];
    const seen = new Set<string>();
    for (const row of [...rows].sort((a, b) => b.finishedAt - a.finishedAt)) {
        const key = `${row.source}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push({ ...row, bytes: Number.isFinite(row.bytes) ? row.bytes : 0 });
        if (unique.length >= MAX_DOWNLOAD_HISTORY) break;
    }
    return unique;
};

export const readDownloadHistory = (storage: HistoryStorage = window.localStorage): DownloadHistoryEntry[] => {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(DOWNLOAD_HISTORY_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return normalize(parsed.filter(isEntry));
    } catch {
        return [];
    }
};

const writeDownloadHistory = (
    rows: readonly DownloadHistoryEntry[],
    storage: HistoryStorage,
): DownloadHistoryEntry[] => {
    const next = normalize(rows);
    try {
        storage.setItem(DOWNLOAD_HISTORY_KEY, JSON.stringify(next));
    } catch {
        // History is optional; keep the in-memory event going.
    }
    window.dispatchEvent(new CustomEvent(DOWNLOAD_HISTORY_EVENT, { detail: { history: next } }));
    return next;
};

export const addDownloadHistory = (
    entry: DownloadHistoryEntry,
    storage: HistoryStorage = window.localStorage,
): DownloadHistoryEntry[] => {
    const key = `${entry.source}:${entry.id}`;
    const previous = readDownloadHistory(storage).filter((row) => `${row.source}:${row.id}` !== key);
    return writeDownloadHistory([entry, ...previous], storage);
};

export const removeDownloadHistory = (
    id: string,
    source: DownloadHistoryEntry["source"],
    storage: HistoryStorage = window.localStorage,
): DownloadHistoryEntry[] => {
    const key = `${source}:${id}`;
    return writeDownloadHistory(
        readDownloadHistory(storage).filter((row) => `${row.source}:${row.id}` !== key),
        storage,
    );
};

export const clearDownloadHistory = (storage: HistoryStorage = window.localStorage): void => {
    writeDownloadHistory([], storage);
};

/** Records browser downloads and finished Downloader jobs into the shared history. */
export const useDownloadHistoryRecorder = (): void => {
    useEffect(() => {
        const offBrowser = window.electron.on("browser:download", (download) => {
            if (download.state === "progressing") return;
            const status: DownloadHistoryStatus =
                download.state === "completed"
                    ? "done"
                    : download.state === "interrupted"
                      ? "interrupted"
                      : "cancelled";
            addDownloadHistory({
                id: download.id,
                source: "browser",
                title: download.filename,
                url: download.url,
                path: download.savePath,
                status,
                bytes: download.received,
                finishedAt: Date.now(),
            });
        });

        const terminal = new Set<string>();
        const offDownloader = window.electron.on("downloader:state", (state) => {
            for (const job of state.jobs) {
                if (job.status !== "done" && job.status !== "error" && job.status !== "cancelled") continue;
                const key = `${job.id}:${job.status}`;
                if (terminal.has(key)) continue;
                terminal.add(key);
                const status: DownloadHistoryStatus =
                    job.status === "done" ? "done" : job.status === "cancelled" ? "cancelled" : "error";
                const add = (bytes: number) => {
                    addDownloadHistory({
                        id: job.id,
                        source: "downloader",
                        title: job.title || job.url,
                        url: job.url,
                        path: job.outputPath,
                        status,
                        bytes,
                        finishedAt: Date.now(),
                        message: job.error || job.message || undefined,
                    });
                };
                if (job.outputPath) {
                    void window.fs
                        .stat(job.outputPath)
                        .then((stats) => add(Number(stats.size) || 0))
                        .catch(() => add(0));
                } else {
                    add(0);
                }
            }
        });

        return () => {
            offBrowser();
            offDownloader();
        };
    }, []);
};
