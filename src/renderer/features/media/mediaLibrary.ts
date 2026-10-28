/**
 * Pure helpers for the local media panel.
 *
 * Scanning is expressed against a tiny reader/stat interface instead of `window.fs`, so the
 * recursive walk, filtering, formatting, and resume storage can be unit-tested without Electron.
 * `MediaPanel.tsx` supplies the preload-backed implementation.
 */

import { isVideoPath, normalizeVideoPath, videoTitleFromPath } from "./playlist";

export { isVideoPath, normalizeVideoPath, videoTitleFromPath };

/** How deep below a library root the walk may descend. */
export const DEFAULT_SCAN_MAX_DEPTH = 8;

/** Resume positions closer than this to the end count as finished and are cleared. */
export const END_CLEAR_THRESHOLD_SECONDS = 3;

/** Every resume entry lives under this prefix in localStorage. */
export const POSITION_KEY_PREFIX = "yokomura-media-pos:";

/** Directory names starting with this character are skipped (`.git`, `.cache`, …). */
const HIDDEN_PREFIX = ".";

/** Hard cap on collected scan errors so an unreadable drive cannot grow the result forever. */
const MAX_SCAN_ERRORS = 50;

/** Natural, case-insensitive collator shared by name sorting and search fallbacks. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** One playable file discovered on disk. */
export type VideoEntry = {
    path: string;
    title: string;
    sizeBytes: number;
    modifiedMs: number;
};

/** Normalized stat result used by {@link scanVideoEntries}. */
export type VideoStatInfo = {
    isDirectory: boolean;
    sizeBytes: number;
    modifiedMs: number;
};

/** Filesystem subset needed by {@link scanVideoEntries}. */
export type VideoScanIo = {
    readdir: (directory: string) => Promise<readonly string[]>;
    stat: (path: string) => Promise<VideoStatInfo>;
    join: (directory: string, name: string) => string;
};

export type VideoScanError = {
    path: string;
    message: string;
};

export type VideoScanOptions = {
    /** Directories below roots are scanned while `depth < maxDepth`. Defaults to 8. Use `Infinity` for all. */
    maxDepth?: number;
    /** Aborts a long "All depths" walk without discarding already collected entries. */
    signal?: AbortSignal;
};

export type VideoScanResult = {
    entries: VideoEntry[];
    /** Directories/files that could not be read; the walk continues past them. */
    errors: VideoScanError[];
};

export type VideoSortMode = "name" | "newest";

export type VideoFilterOptions = {
    /** Whitespace-separated terms; every term must match the title or path. */
    query?: string;
    sort?: VideoSortMode;
};

/** localStorage-compatible shape; keeps the helpers independent of `window` in tests. */
export type MediaPositionStorage = {
    readonly length: number;
    key: (index: number) => string | null;
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
    removeItem: (key: string) => void;
};

/** One persisted resume position. */
export type WatchedPosition = {
    path: string;
    time: number;
    /** Total duration when it was known; `0` for legacy plain-number entries. */
    duration: number;
    /** Epoch milliseconds of the last write; `0` for legacy entries. */
    updatedAt: number;
};

export type ContinueWatchingItem = {
    entry: VideoEntry;
    position: WatchedPosition;
};

/** Key used for one file's resume position. */
export const positionStorageKey = (path: string): string => `${POSITION_KEY_PREFIX}${path}`;

/** Stable key for visited-directory de-duplication (separators/case/trailing slash folded). */
const directoryKey = (path: string): string => {
    const normalized = normalizeVideoPath(path).replace(/\/+$/, "");
    return normalized || normalizeVideoPath(path);
};

const toErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";

const finiteNonNegative = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * Walks every root to {@link DEFAULT_SCAN_MAX_DEPTH} (or `options.maxDepth`) and returns the
 * supported video files. Unreadable directories/files are collected in `errors` instead of
 * aborting the whole scan, so a single permission problem never hides the rest of the library.
 *
 * The input `roots` are not mutated and duplicate roots (or overlapping roots) only yield one
 * entry per normalized path.
 */
export const scanVideoEntries = async (
    io: VideoScanIo,
    roots: readonly string[],
    options: VideoScanOptions = {},
): Promise<VideoScanResult> => {
    const requestedDepth = options.maxDepth ?? DEFAULT_SCAN_MAX_DEPTH;
    const maxDepth = Number.isFinite(requestedDepth)
        ? Math.max(0, Math.trunc(requestedDepth))
        : Number.POSITIVE_INFINITY;
    const entries: VideoEntry[] = [];
    const errors: VideoScanError[] = [];
    const seenFiles = new Set<string>();
    const visitedDirectories = new Set<string>();

    const pushError = (path: string, error: unknown): void => {
        if (errors.length >= MAX_SCAN_ERRORS) return;
        errors.push({ path, message: toErrorMessage(error) });
    };

    const walk = async (directory: string, depth: number): Promise<void> => {
        if (options.signal?.aborted) return;
        const key = directoryKey(directory);
        if (!key || visitedDirectories.has(key)) return;
        visitedDirectories.add(key);

        let names: readonly string[];
        try {
            names = await io.readdir(directory);
        } catch (error) {
            pushError(directory, error);
            return;
        }
        if (!Array.isArray(names)) return;

        const subdirectories: string[] = [];

        for (const name of names) {
            if (options.signal?.aborted) return;
            if (typeof name !== "string" || !name) continue;

            const childPath = io.join(directory, name);

            let info: VideoStatInfo;
            try {
                info = await io.stat(childPath);
            } catch (error) {
                pushError(childPath, error);
                continue;
            }

            if (info.isDirectory) {
                if (depth < maxDepth && !name.startsWith(HIDDEN_PREFIX)) subdirectories.push(childPath);
                continue;
            }

            if (!isVideoPath(name)) continue;

            const fileKey = normalizeVideoPath(childPath);
            if (!fileKey || seenFiles.has(fileKey)) continue;
            seenFiles.add(fileKey);

            entries.push({
                path: childPath,
                title: videoTitleFromPath(name),
                sizeBytes: finiteNonNegative(info.sizeBytes),
                modifiedMs: finiteNonNegative(info.modifiedMs),
            });
        }

        for (const subdirectory of subdirectories) {
            if (options.signal?.aborted) return;
            await walk(subdirectory, depth + 1);
        }
    };

    for (const root of roots) {
        if (options.signal?.aborted) break;
        const trimmed = typeof root === "string" ? root.trim() : "";
        if (!trimmed) continue;
        await walk(trimmed, 0);
    }

    return { entries, errors };
};

/**
 * True when every whitespace-separated query term occurs in the title or path.
 * Empty queries match everything.
 */
export const matchesVideoQuery = (entry: VideoEntry, query: string): boolean => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = `${entry.title}\n${entry.path}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
};

/**
 * Filters by title/path and sorts without mutating the input.
 *
 * `newest` puts the most recently modified file first and unknown timestamps last; `name`
 * compares titles naturally, so `ep2` sorts before `ep10`.
 */
export const filterAndSortVideos = (
    entries: readonly VideoEntry[],
    options: VideoFilterOptions = {},
): VideoEntry[] => {
    const query = options.query ?? "";
    const filtered = query.trim() ? entries.filter((entry) => matchesVideoQuery(entry, query)) : [...entries];

    const sort = options.sort ?? "newest";

    filtered.sort((a, b) => {
        if (sort === "name") {
            const byTitle = collator.compare(a.title, b.title);
            return byTitle !== 0 ? byTitle : collator.compare(a.path, b.path);
        }

        const aTime = finiteNonNegative(a.modifiedMs);
        const bTime = finiteNonNegative(b.modifiedMs);
        if (aTime !== bTime) {
            if (aTime === 0) return 1;
            if (bTime === 0) return -1;
            return bTime - aTime;
        }
        return collator.compare(a.title, b.title);
    });

    return filtered;
};

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;
/** Human byte count (`0 B`, `12.4 MB`). Invalid or negative input renders as `0 B`. */
export const formatBytes = (bytes: number): string => {
    const value = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
    if (value < 1024) return `${Math.round(value)} B`;

    let scaled = value;
    let unit = 0;
    while (scaled >= 1024 && unit < BYTE_UNITS.length - 1) {
        scaled /= 1024;
        unit += 1;
    }
    const rounded = scaled >= 100 ? scaled.toFixed(0) : scaled.toFixed(1);
    return `${rounded} ${BYTE_UNITS[unit]}`;
};

/**
 * Horizontal offset (px) for a floating seek-preview card centred on `fraction` of the track.
 * The result is clamped so the card never leaves the seek bar; a track narrower than the card
 * centres it instead. Used by the hover preview and covered by unit tests.
 */
export const seekPreviewLeft = (
    fraction: number,
    trackWidth: number,
    cardWidth: number,
    edgePadding = 4,
): number => {
    if (!Number.isFinite(trackWidth) || trackWidth <= 0) return 0;

    const halfCard = Math.max(0, cardWidth) / 2 + Math.max(0, edgePadding);
    const clampEdge = Math.min(trackWidth / 2, halfCard);
    const position = (Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0) * trackWidth;

    return Math.min(Math.max(clampEdge, position), Math.max(clampEdge, trackWidth - clampEdge));
};

/**
 * Player clock: `m:ss` below an hour and `h:mm:ss` above it.
 * Non-finite/negative values render as `0:00`.
 */
export const formatTime = (seconds: number): string => {
    const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    const pad = (value: number): string => String(value).padStart(2, "0");
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
};

const parsePositionValue = (raw: string | null): Omit<WatchedPosition, "path"> | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    let time = Number.NaN;
    let duration = 0;
    let updatedAt = 0;

    if (trimmed.startsWith("{")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (!parsed || typeof parsed !== "object") return null;
            const record = parsed as { time?: unknown; duration?: unknown; updatedAt?: unknown };
            time = typeof record.time === "number" ? record.time : Number.NaN;
            duration = typeof record.duration === "number" ? record.duration : 0;
            updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0;
        } catch {
            return null;
        }
    } else {
        /* Legacy entries written as a bare number of seconds. */
        time = Number.parseFloat(trimmed);
    }

    if (!Number.isFinite(time) || time <= 0) return null;

    return {
        time,
        duration: finiteNonNegative(duration),
        updatedAt: finiteNonNegative(updatedAt),
    };
};

/** Reads one file's resume position, or `null` when absent/malformed. */
export const readWatchedPosition = (storage: MediaPositionStorage, path: string): WatchedPosition | null => {
    if (!path.trim()) return null;
    try {
        const parsed = parsePositionValue(storage.getItem(positionStorageKey(path)));
        return parsed ? { path, ...parsed } : null;
    } catch {
        return null;
    }
};

/**
 * Reads every resume entry, newest write first. Legacy plain-number values are accepted so
 * positions saved before the JSON format still restore. Storage failures return `[]`.
 */
export const readWatchedPositions = (storage: MediaPositionStorage): WatchedPosition[] => {
    const positions: WatchedPosition[] = [];
    try {
        const length = Number.isFinite(storage.length) ? storage.length : 0;
        for (let index = 0; index < length; index += 1) {
            const key = storage.key(index);
            if (!key || !key.startsWith(POSITION_KEY_PREFIX)) continue;
            const path = key.slice(POSITION_KEY_PREFIX.length);
            if (!path) continue;
            const parsed = parsePositionValue(storage.getItem(key));
            if (parsed) positions.push({ path, ...parsed });
        }
    } catch {
        return [];
    }

    return positions.sort((a, b) => b.updatedAt - a.updatedAt || collator.compare(a.path, b.path));
};

/** Removes one resume entry; storage failures are ignored. */
export const removeWatchedPosition = (storage: MediaPositionStorage, path: string): void => {
    try {
        storage.removeItem(positionStorageKey(path));
    } catch {
        // storage can be unavailable - playback must keep working
    }
};

/**
 * Persists `time` for `path`. Entries within {@link END_CLEAR_THRESHOLD_SECONDS} of the known
 * duration are removed instead of written, and non-finite/zero times are ignored.
 *
 * @returns whether a position was written
 */
export const writeWatchedPosition = (
    storage: MediaPositionStorage,
    path: string,
    time: number,
    duration = 0,
    now = Date.now(),
): boolean => {
    const trimmed = path.trim();
    if (!trimmed || !Number.isFinite(time) || time <= 0) return false;

    const safeDuration = finiteNonNegative(duration);
    if (safeDuration > 0 && safeDuration - time <= END_CLEAR_THRESHOLD_SECONDS) {
        removeWatchedPosition(storage, trimmed);
        return false;
    }

    const payload = {
        time: Math.round(time * 100) / 100,
        duration: Math.round(safeDuration * 100) / 100,
        updatedAt: Number.isFinite(now) ? now : Date.now(),
    };

    try {
        storage.setItem(positionStorageKey(trimmed), JSON.stringify(payload));
        return true;
    } catch {
        return false;
    }
};

/**
 * Joins resume positions to the current scan result, newest first. Positions for files that are
 * no longer on disk, finished files, and duplicate paths are dropped.
 */
export const continueWatchingVideos = (
    entries: readonly VideoEntry[],
    positions: readonly WatchedPosition[],
    limit = 8,
): ContinueWatchingItem[] => {
    const cap = Math.max(0, Math.trunc(limit));
    if (cap === 0) return [];

    const byPath = new Map<string, VideoEntry>();
    for (const entry of entries) {
        const key = normalizeVideoPath(entry.path);
        if (key && !byPath.has(key)) byPath.set(key, entry);
    }

    const seen = new Set<string>();
    const items: ContinueWatchingItem[] = [];

    for (const position of [...positions].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const key = normalizeVideoPath(position.path);
        if (!key || seen.has(key)) continue;

        const entry = byPath.get(key);
        if (!entry) continue;

        if (!Number.isFinite(position.time) || position.time <= 0) continue;
        if (position.duration > 0 && position.duration - position.time <= END_CLEAR_THRESHOLD_SECONDS) {
            continue;
        }

        seen.add(key);
        items.push({ entry, position });
        if (items.length >= cap) break;
    }

    return items;
};
