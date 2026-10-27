/**
 * Pure playlist helpers for the built-in video player.
 *
 * Everything here is filesystem-agnostic: entries only carry a local path and a display title,
 * so the helpers can be used in the renderer and exercised in unit tests without Electron.
 */

/** Container formats the built-in player accepts. Keep in sync with `VIDEO_EXTS` in common/formats. */
export const VIDEO_EXTENSIONS = [".mp4", ".webm"] as const;

/** Minimal shape shared by playlist entries rendered in the player. */
export type PlaylistEntry = {
    path: string;
    title: string;
};

/**
 * Sort collator: numeric chunks keep `ep2` before `ep10`, and case differences do not reorder siblings.
 */
const pathCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Windows-friendly key for comparing paths from different sources.
 * Separators become `/`, surrounding whitespace is dropped, and Latin case is folded.
 */
export const normalizeVideoPath = (path: string): string => path.trim().replaceAll("\\", "/").toLowerCase();

/** True when {@link path} ends with a supported video extension (case-insensitive). */
export const isVideoPath = (path: string): boolean => {
    const lower = path.trim().toLowerCase();
    return VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension));
};

/** Display title derived from a file path (`C:\Shows\ep1.mp4` -> `ep1`). */
export const videoTitleFromPath = (path: string): string => {
    const normalized = path.trim().replaceAll("\\", "/");
    const fileName = normalized.slice(normalized.lastIndexOf("/") + 1);
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.slice(0, dot) : fileName;
};

/** Drops non-video entries while preserving the caller's order. */
export const filterVideoItems = <T extends PlaylistEntry>(items: readonly T[]): T[] =>
    items.filter((item) => isVideoPath(item.path));

/** Natural, case-insensitive path sort. The input array is never mutated. */
export const sortVideoItems = <T extends PlaylistEntry>(items: readonly T[]): T[] =>
    [...items].sort((a, b) => pathCollator.compare(a.path, b.path));

/**
 * Normalizes a sibling list for the playlist panel: supported videos only, natural path order,
 * one entry per path, and a filename-derived title when the supplied title is blank.
 */
export const buildVideoPlaylist = (items: readonly PlaylistEntry[]): PlaylistEntry[] => {
    const seen = new Set<string>();
    const unique: PlaylistEntry[] = [];

    /* Dedupe in input order first so the first supplied title wins for a repeated path. */
    for (const item of filterVideoItems(items)) {
        const key = normalizeVideoPath(item.path);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const title = typeof item.title === "string" ? item.title.trim() : "";
        unique.push({ path: item.path, title: title || videoTitleFromPath(item.path) });
    }

    return sortVideoItems(unique);
};

/**
 * Index of the entry matching {@link path}, or `-1` when it is not in the playlist.
 * Comparison uses {@link normalizeVideoPath}, so separator/case variants still match.
 */
export const findVideoIndex = (playlist: readonly PlaylistEntry[], path: string): number => {
    const key = normalizeVideoPath(path);
    return playlist.findIndex((item) => normalizeVideoPath(item.path) === key);
};

/** Entry after {@link path}; wraps from the last entry to the first. `null` for an empty playlist. */
export const nextVideo = <T extends PlaylistEntry>(playlist: readonly T[], path: string): T | null => {
    if (playlist.length === 0) return null;
    const index = findVideoIndex(playlist, path);
    if (index < 0) return playlist[0] ?? null;
    return playlist[(index + 1) % playlist.length] ?? null;
};

/** Entry before {@link path}; wraps from the first entry to the last. `null` for an empty playlist. */
export const prevVideo = <T extends PlaylistEntry>(playlist: readonly T[], path: string): T | null => {
    if (playlist.length === 0) return null;
    const index = findVideoIndex(playlist, path);
    if (index < 0) return playlist[playlist.length - 1] ?? null;
    return playlist[(index - 1 + playlist.length) % playlist.length] ?? null;
};
