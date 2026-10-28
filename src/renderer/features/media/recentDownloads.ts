import { isVideoPath, normalizeVideoPath } from "./playlist";

/** localStorage key for browser-downloaded videos shown in Media. */
export const RECENT_DOWNLOADS_KEY = "yokomura-media-recent-downloads";

/** Fired in-window after the playlist changes. */
export const RECENT_DOWNLOADS_EVENT = "yokomura-media-recent-downloads-changed";

/** Keep the playlist small; it is a recent-history view, not the library. */
export const MAX_RECENT_DOWNLOADS = 50;

export type RecentDownload = {
    path: string;
    downloadedAt: number;
};

type RecentStorage = Pick<Storage, "getItem" | "setItem">;

const isRecentDownload = (value: unknown): value is RecentDownload => {
    if (!value || typeof value !== "object") return false;
    const row = value as { path?: unknown; downloadedAt?: unknown };
    return (
        typeof row.path === "string" &&
        row.path.trim().length > 0 &&
        typeof row.downloadedAt === "number" &&
        Number.isFinite(row.downloadedAt)
    );
};

/** Dedupes by Windows-friendly path, keeps newest first, drops non-video/missing rows. */
const normalizeDownloads = (rows: readonly RecentDownload[]): RecentDownload[] => {
    const unique: RecentDownload[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const path = row.path.trim();
        const key = normalizeVideoPath(path);
        if (!key || seen.has(key) || !isVideoPath(path)) continue;
        seen.add(key);
        unique.push({ path, downloadedAt: row.downloadedAt });
    }
    unique.sort((a, b) => b.downloadedAt - a.downloadedAt);
    return unique.slice(0, MAX_RECENT_DOWNLOADS);
};

/** Reads the persisted playlist; corrupt or missing storage reads as empty. */
export const readRecentDownloads = (storage: RecentStorage = window.localStorage): RecentDownload[] => {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(RECENT_DOWNLOADS_KEY) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return normalizeDownloads(parsed.filter(isRecentDownload));
    } catch {
        return [];
    }
};

const writeRecentDownloads = (rows: readonly RecentDownload[], storage: RecentStorage): RecentDownload[] => {
    const next = normalizeDownloads(rows);
    try {
        storage.setItem(RECENT_DOWNLOADS_KEY, JSON.stringify(next));
    } catch {
        // Storage can be unavailable; the in-memory update still applies.
    }
    window.dispatchEvent(new CustomEvent(RECENT_DOWNLOADS_EVENT, { detail: { downloads: next } }));
    return next;
};

/**
 * Adds one browser download. Non-video paths are ignored. A later download of
 * the same path moves it to the top instead of duplicating it.
 */
export const addRecentDownload = (
    path: string,
    downloadedAt: number = Date.now(),
    storage: RecentStorage = window.localStorage,
): RecentDownload[] => {
    const trimmed = path.trim();
    if (!isVideoPath(trimmed)) return readRecentDownloads(storage);

    const key = normalizeVideoPath(trimmed);
    const previous = readRecentDownloads(storage).filter((row) => normalizeVideoPath(row.path) !== key);
    return writeRecentDownloads([{ path: trimmed, downloadedAt }, ...previous], storage);
};

/** Empties the playlist without touching the downloaded files. */
export const clearRecentDownloads = (storage: RecentStorage = window.localStorage): void => {
    writeRecentDownloads([], storage);
};
