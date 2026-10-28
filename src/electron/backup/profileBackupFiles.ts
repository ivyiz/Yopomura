import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

/** Manifest written at the root of every full profile backup ZIP. */
export const PROFILE_BACKUP_MANIFEST = "yokomura-profile.json";

/** Marker written under userData when a restore has been staged for the next launch. */
export const PROFILE_RESTORE_MARKER = "profile-restore-pending.json";

/** Staging folder under userData that holds an extracted profile payload. */
export const PROFILE_RESTORE_PENDING_DIR = "profile-restore-pending";

/** Prefix for safety copies of the profile files replaced during a restore. */
export const PROFILE_RESTORE_PREVIOUS_PREFIX = "profile-restore-previous-";

/** Current manifest schema version. */
const PROFILE_BACKUP_FORMAT = 1;

/** Profile entries that live directly under userData, in backup order. */
const PROFILE_ENTRY_CANDIDATES = [
    "data.db",
    "main-settings.json",
    "settings.json",
    "reader-presets.json",
    "shortcuts.json",
    "themes.json",
    "browser-bookmarks.json",
    "announcements.txt",
    "covers/",
    "trash-journal.json",
    "trash/",
] as const;

/** Shape of `yokomura-profile.json` inside a full profile backup. */
export type ProfileBackupManifest = {
    format: 1;
    appVersion: string;
    createdAt: number;
    files: string[];
};

/** Describes a staged restore marker: where the payload is and when it was staged. */
export type ProfileRestoreMarker = {
    stagingPath: string;
    createdAt: number;
};

/** True when a path segment contains an ASCII control character. */
const hasControlCharacter = (value: string): boolean => {
    for (const character of value) {
        if (character.charCodeAt(0) < 32) return true;
    }
    return false;
};

/**
 * Normalizes a manifest/entry path to forward slashes without a trailing slash.
 * This does not make an unsafe path safe; pair it with {@link isSafeProfileRelativePath}.
 */
export const normalizeProfileRelativePath = (value: string): string =>
    value.replace(/\\/g, "/").replace(/\/+$/, "");

/**
 * True when `value` is a relative profile path with no drive, UNC, `.` or `..` escape.
 * A trailing slash is allowed because directory entries such as `covers/` use it.
 */
export const isSafeProfileRelativePath = (value: string): boolean => {
    if (typeof value !== "string" || value.length === 0) return false;
    if (hasControlCharacter(value)) return false;
    if (/^[A-Za-z]:/.test(value)) return false;
    if (value.startsWith("/") || value.startsWith("\\")) return false;

    const normalized = normalizeProfileRelativePath(value);
    if (!normalized) return false;
    return normalized.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
};

/**
 * True when `candidate` resolves to `root` or a descendant of it.
 * Uses `path.relative` so a sibling named `..foo` is not mistaken for a traversal.
 */
export const isPathInsideRoot = (root: string, candidate: string): boolean => {
    const rootResolved = path.resolve(root);
    const candidateResolved = path.resolve(candidate);
    const relative = path.relative(rootResolved, candidateResolved);
    if (relative === "") return true;
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

/**
 * Resolves a profile-relative entry against `root`.
 * @returns the absolute path, or `null` when the entry is unsafe or escapes `root`
 */
export const resolveProfileEntryPath = (root: string, entry: string): string | null => {
    if (!isSafeProfileRelativePath(entry)) return null;
    const normalized = normalizeProfileRelativePath(entry);
    const resolved = path.resolve(root, ...normalized.split("/"));
    return isPathInsideRoot(root, resolved) ? resolved : null;
};

/** Absolute staging folder for a pending profile restore. */
export const getProfileRestorePendingDir = (userDataPath: string): string =>
    path.join(userDataPath, PROFILE_RESTORE_PENDING_DIR);

/** Absolute marker file for a pending profile restore. */
export const getProfileRestoreMarkerPath = (userDataPath: string): string =>
    path.join(userDataPath, PROFILE_RESTORE_MARKER);

/** Absolute safety-copy folder for the restore identified by `timestamp`. */
export const getProfileRestorePreviousDir = (userDataPath: string, timestamp: number): string =>
    path.join(userDataPath, `${PROFILE_RESTORE_PREVIOUS_PREFIX}${timestamp}`);

/** True when a marker points at the one staging folder we create under userData. */
export const isExpectedProfileRestoreStagingPath = (userDataPath: string, stagingPath: string): boolean =>
    path.resolve(stagingPath) === path.resolve(getProfileRestorePendingDir(userDataPath)) &&
    isPathInsideRoot(userDataPath, stagingPath);

/**
 * Lists the profile entries that currently exist under `userDataPath`.
 * Caches, logs, i18n packs, automatic DB backups, and restore staging are intentionally excluded.
 */
export const collectProfileEntries = (userDataPath: string): string[] => {
    const entries: string[] = [];
    for (const entry of PROFILE_ENTRY_CANDIDATES) {
        const resolved = resolveProfileEntryPath(userDataPath, entry);
        if (!resolved) continue;
        try {
            const stat = fs.statSync(resolved);
            const isDirectoryEntry = entry.endsWith("/");
            if (isDirectoryEntry ? stat.isDirectory() : stat.isFile()) entries.push(entry);
        } catch {
            /* missing or unreadable entries are not part of the profile */
        }
    }
    return entries;
};

/** Returns true when `value` is a complete, safe `yokomura-profile.json` payload. */
export const validateProfileManifest = (value: unknown): value is ProfileBackupManifest => {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;
    return (
        candidate.format === PROFILE_BACKUP_FORMAT &&
        typeof candidate.appVersion === "string" &&
        candidate.appVersion.length > 0 &&
        typeof candidate.createdAt === "number" &&
        Number.isFinite(candidate.createdAt) &&
        Array.isArray(candidate.files) &&
        candidate.files.length > 0 &&
        candidate.files.every((file) => typeof file === "string" && isSafeProfileRelativePath(file))
    );
};

/**
 * Walks an extracted profile tree and rejects entries that escape the staging root,
 * including symbolic links and non-file/directory special entries.
 */
export const validateExtractedTree = async (root: string): Promise<void> => {
    const rootReal = await fsp.realpath(root);
    const walk = async (directory: string): Promise<void> => {
        const children = await fsp.readdir(directory, { withFileTypes: true });
        for (const child of children) {
            const full = path.join(directory, child.name);
            if (!isPathInsideRoot(root, full)) {
                throw new Error(`Profile archive entry escapes the staging directory: ${child.name}`);
            }
            const stat = await fsp.lstat(full);
            if (stat.isSymbolicLink()) {
                throw new Error(`Profile archive contains a symbolic link: ${child.name}`);
            }
            const real = await fsp.realpath(full);
            if (!isPathInsideRoot(rootReal, real)) {
                throw new Error(`Profile archive entry resolves outside the staging directory: ${child.name}`);
            }
            if (stat.isDirectory()) {
                await walk(full);
            } else if (!stat.isFile()) {
                throw new Error(`Profile archive contains an unsupported entry: ${child.name}`);
            }
        }
    };
    await walk(root);
};

/** Default save-dialog name for a profile backup: `Yopomura-profile-YYYY-MM-DD.zip`. */
export const profileBackupFileName = (date: Date = new Date()): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `Yopomura-profile-${year}-${month}-${day}.zip`;
};
