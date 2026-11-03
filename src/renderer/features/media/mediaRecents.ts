import { normalizeVideoPath, videoTitleFromPath } from "./playlist";

/**
 * Persisted "recently opened" history for the Media panel.
 *
 * Two lists live in `localStorage`, mirroring `recentDownloads.ts`:
 * - videos opened in the player (including finished ones)
 * - folders used as a media root
 *
 * They are a convenience history, not the library, so they stay small and are
 * pruned silently when a path is gone.
 */

/** localStorage key for recently opened videos. */
export const RECENT_VIDEOS_KEY = "yokomura-media-recent-videos";

/** localStorage key for recently opened media folders. */
export const RECENT_FOLDERS_KEY = "yokomura-media-recent-folders";

/** Fired in-window after either recents list changes. */
export const MEDIA_RECENTS_EVENT = "yokomura-media-recents-changed";

export const MAX_RECENT_VIDEOS = 24;
export const MAX_RECENT_FOLDERS = 8;

export type RecentVideo = {
    path: string;
    /** Display title captured when the video was opened. */
    title: string;
    /** Epoch milliseconds of the last open. */
    openedAt: number;
};

export type RecentFolder = {
    path: string;
    /** Epoch milliseconds of the last open. */
    openedAt: number;
};

type RecentStorage = Pick<Storage, "getItem" | "setItem">;

const isFiniteTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isRecentVideo = (value: unknown): value is RecentVideo => {
    if (!value || typeof value !== "object") return false;
    const row = value as { path?: unknown; title?: unknown; openedAt?: unknown };
    return (
        typeof row.path === "string" &&
        row.path.trim().length > 0 &&
        typeof row.title === "string" &&
        isFiniteTime(row.openedAt)
    );
};

const isRecentFolder = (value: unknown): value is RecentFolder => {
    if (!value || typeof value !== "object") return false;
    const row = value as { path?: unknown; openedAt?: unknown };
    return typeof row.path === "string" && row.path.trim().length > 0 && isFiniteTime(row.openedAt);
};

/** Windows-friendly key for a directory, ignoring trailing separators. */
const folderKey = (path: string): string => {
    const normalized = normalizeVideoPath(path);
    return normalized.replace(/\/+$/, "") || normalized;
};

const normalizeVideos = (rows: readonly RecentVideo[]): RecentVideo[] => {
    const unique: RecentVideo[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const path = row.path.trim();
        const key = normalizeVideoPath(path);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({
            path,
            title: row.title.trim() || videoTitleFromPath(path),
            openedAt: row.openedAt,
        });
    }
    unique.sort((a, b) => b.openedAt - a.openedAt);
    return unique.slice(0, MAX_RECENT_VIDEOS);
};

const normalizeFolders = (rows: readonly RecentFolder[]): RecentFolder[] => {
    const unique: RecentFolder[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const path = row.path.trim();
        const key = folderKey(path);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push({ path, openedAt: row.openedAt });
    }
    unique.sort((a, b) => b.openedAt - a.openedAt);
    return unique.slice(0, MAX_RECENT_FOLDERS);
};

const readJson = (storage: RecentStorage, key: string): unknown => {
    try {
        return JSON.parse(storage.getItem(key) ?? "[]");
    } catch {
        return [];
    }
};

/** Reads recently opened videos; corrupt or missing storage reads as empty. */
export const readRecentVideos = (storage: RecentStorage = window.localStorage): RecentVideo[] => {
    const parsed = readJson(storage, RECENT_VIDEOS_KEY);
    if (!Array.isArray(parsed)) return [];
    return normalizeVideos(parsed.filter(isRecentVideo));
};

/** Reads recently opened folders; corrupt or missing storage reads as empty. */
export const readRecentFolders = (storage: RecentStorage = window.localStorage): RecentFolder[] => {
    const parsed = readJson(storage, RECENT_FOLDERS_KEY);
    if (!Array.isArray(parsed)) return [];
    return normalizeFolders(parsed.filter(isRecentFolder));
};

const emit = (): void => {
    window.dispatchEvent(new CustomEvent(MEDIA_RECENTS_EVENT));
};

const writeVideos = (rows: readonly RecentVideo[], storage: RecentStorage): RecentVideo[] => {
    const next = normalizeVideos(rows);
    try {
        storage.setItem(RECENT_VIDEOS_KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable; in-memory state still updates */
    }
    return next;
};

const writeFolders = (rows: readonly RecentFolder[], storage: RecentStorage): RecentFolder[] => {
    const next = normalizeFolders(rows);
    try {
        storage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(next));
    } catch {
        /* storage unavailable; in-memory state still updates */
    }
    return next;
};

/**
 * Records a video open. Reopening the same file moves it to the top instead of
 * duplicating it.
 */
export const addRecentVideo = (
    path: string,
    title?: string,
    openedAt: number = Date.now(),
    storage: RecentStorage = window.localStorage,
): RecentVideo[] => {
    const trimmed = path.trim();
    if (!trimmed) return readRecentVideos(storage);
    const key = normalizeVideoPath(trimmed);
    const previous = readRecentVideos(storage).filter((row) => normalizeVideoPath(row.path) !== key);
    const next = writeVideos(
        [{ path: trimmed, title: title?.trim() || videoTitleFromPath(trimmed), openedAt }, ...previous],
        storage,
    );
    emit();
    return next;
};

/** Records a folder used as a media root, newest first. */
export const addRecentFolder = (
    path: string,
    openedAt: number = Date.now(),
    storage: RecentStorage = window.localStorage,
): RecentFolder[] => {
    const trimmed = path.trim();
    if (!trimmed) return readRecentFolders(storage);
    const key = folderKey(trimmed);
    const previous = readRecentFolders(storage).filter((row) => folderKey(row.path) !== key);
    const next = writeFolders([{ path: trimmed, openedAt }, ...previous], storage);
    emit();
    return next;
};

/** Clears the video history and notifies listeners. */
export const clearRecentVideos = (storage: RecentStorage = window.localStorage): void => {
    writeVideos([], storage);
    emit();
};

/** Clears the folder history and notifies listeners. */
export const clearRecentFolders = (storage: RecentStorage = window.localStorage): void => {
    writeFolders([], storage);
    emit();
};
