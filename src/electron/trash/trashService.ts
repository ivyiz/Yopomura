import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    DEFAULT_TRASH_RETENTION_DAYS,
    isTrashRetentionDays,
    type PurgeTrashResult,
    type RestoreTrashResult,
    type TrashEntry,
    type TrashEntryKind,
    type TrashItemType,
    type TrashRetentionDays,
} from "@common/types/trash";
import { appendTrashEntry, getEntry, listTrashEntries, markRestored, removeEntry } from "@electron/trash/journal";
import { restoreFromRecycleBin } from "@electron/trash/recycleBin";
import { createMainLogger } from "@electron/util/logger";
import { app, shell } from "electron";

const logger = createMainLogger("trash/service");

const DAY_MS = 24 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 60_000;

export type MoveToTrashInput = {
    path: string;
    kind?: TrashEntryKind;
    title?: string;
    itemType?: TrashItemType;
    retentionDays?: number;
};

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Absolute root of the app-managed trash inside `userData`. */
export const getTrashRoot = (): string => path.join(app.getPath("userData"), "trash");

const isInsideTrashRoot = (candidate: string): boolean => {
    const root = path.resolve(getTrashRoot());
    const resolved = path.resolve(candidate);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
};

const pathExists = async (candidate: string): Promise<boolean> => {
    try {
        await fs.access(candidate);
        return true;
    } catch {
        return false;
    }
};

/**
 * Moves `source` to `destination`. Uses an atomic rename on the same volume and
 * falls back to a recursive copy followed by removing the source.
 */
const movePath = async (source: string, destination: string): Promise<void> => {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    try {
        await fs.rename(source, destination);
        return;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    }

    await fs.cp(source, destination, {
        recursive: true,
        force: false,
        errorOnExist: true,
        preserveTimestamps: true,
    });
    try {
        await fs.rm(source, { recursive: true, force: true });
    } catch (error) {
        await fs.rm(destination, { recursive: true, force: true }).catch(() => undefined);
        throw error;
    }
};

/**
 * Picks the original path when it is free, otherwise appends `(recovered)` and
 * an increasing counter so recovering never overwrites another file.
 */
export const resolveRecoveryPath = async (
    originalPath: string,
    kind: TrashEntryKind,
    exists: (candidate: string) => Promise<boolean> = pathExists,
): Promise<string> => {
    const target = path.normalize(originalPath);
    if (!(await exists(target))) return target;

    if (kind === "folder") {
        const base = target.replace(/[\\/]+$/, "");
        for (let index = 1; index < 1000; index += 1) {
            const suffix = index === 1 ? " (recovered)" : ` (recovered ${index})`;
            const candidate = `${base}${suffix}`;
            if (!(await exists(candidate))) return candidate;
        }
        throw new Error("Could not find a free folder name for this recovery.");
    }

    const parsed = path.parse(target);
    for (let index = 1; index < 1000; index += 1) {
        const suffix = index === 1 ? " (recovered)" : ` (recovered ${index})`;
        const candidate = path.join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);
        if (!(await exists(candidate))) return candidate;
    }
    throw new Error("Could not find a free file name for this recovery.");
};

const retentionOrDefault = (value: number | undefined): TrashRetentionDays =>
    isTrashRetentionDays(value) ? value : DEFAULT_TRASH_RETENTION_DAYS;

/**
 * Moves a file or folder into `userData/trash/<id>/` and records its countdown
 * in the journal. The original path is removed only after the move succeeds.
 */
export const moveToTrash = async (input: MoveToTrashInput): Promise<TrashEntry> => {
    const source = path.normalize(input.path);
    const stat = await fs.stat(source);
    const kind: TrashEntryKind = input.kind ?? (stat.isDirectory() ? "folder" : "file");
    const id = randomUUID();
    const name = path.basename(source) || source;
    const destination = path.join(getTrashRoot(), id, name);
    const retentionDays = retentionOrDefault(input.retentionDays);

    try {
        await movePath(source, destination);
    } catch (error) {
        await fs.rm(path.dirname(destination), { recursive: true, force: true }).catch(() => undefined);
        throw new Error(`Could not move "${source}" into Recently Deleted: ${errorMessage(error)}`);
    }

    const deletedAt = Date.now();
    try {
        return await appendTrashEntry({
            id,
            originalPath: source,
            name,
            kind,
            deletedAt,
            title: input.title,
            itemType: input.itemType,
            status: "trashed",
            storage: "app",
            trashPath: destination,
            expiresAt: deletedAt + retentionDays * DAY_MS,
            retentionDays,
        });
    } catch (error) {
        await movePath(destination, source).catch((restoreError) =>
            logger.error("could not move item back after journal failure", {
                source,
                destination,
                error: errorMessage(restoreError),
            }),
        );
        throw error;
    }
};

/** Active (not recovered) entries, newest first. */
export const listActiveTrash = async (): Promise<TrashEntry[]> => {
    const entries = await listTrashEntries();
    return entries.filter((entry) => entry.status === "trashed");
};

const fail = (message: string): RestoreTrashResult => ({ ok: false, message });

/**
 * Restores one entry to its original folder. A name collision keeps both files:
 * the recovered copy gets a `(recovered)` suffix.
 */
export const recoverTrashEntry = async (id: string): Promise<RestoreTrashResult> => {
    const entry = await getEntry(id);
    if (!entry) return fail("This Recently Deleted entry no longer exists.");
    if (entry.status !== "trashed") return fail("This item has already been recovered.");

    if (entry.storage === "recycle-bin" || !entry.trashPath) {
        const legacy = await restoreFromRecycleBin(entry.originalPath);
        if (!legacy.ok) return fail(legacy.message);
        const restored = await markRestored(id);
        return {
            ok: true,
            entry: restored ?? { ...entry, status: "restored", restoredAt: Date.now() },
            recoveredPath: entry.originalPath,
        };
    }

    if (!isInsideTrashRoot(entry.trashPath)) {
        return fail("The trashed file is outside the app trash directory.");
    }
    if (!(await pathExists(entry.trashPath))) {
        return fail("The trashed file is missing. Remove this entry and delete the original again.");
    }

    let target: string;
    try {
        target = await resolveRecoveryPath(entry.originalPath, entry.kind);
        await movePath(entry.trashPath, target);
    } catch (error) {
        logger.warn("recover failed", { id, error: errorMessage(error) });
        return fail(`Could not recover this item: ${errorMessage(error)}`);
    }

    await fs.rm(path.dirname(entry.trashPath), { recursive: true, force: true }).catch(() => undefined);
    const restored = await markRestored(id);
    return {
        ok: true,
        entry: { ...(restored ?? entry), recoveredPath: target, status: "restored", restoredAt: Date.now() },
        recoveredPath: target,
    };
};

/** Permanently removes one app-trash entry. */
export const purgeTrashEntry = async (id: string): Promise<PurgeTrashResult> => {
    const entry = await getEntry(id);
    if (!entry) return { ok: false, message: "This Recently Deleted entry no longer exists." };
    if (entry.storage === "recycle-bin" || !entry.trashPath) {
        return {
            ok: false,
            message: "This item is in the Windows Recycle Bin. Restore it, then delete it again.",
        };
    }
    if (!isInsideTrashRoot(entry.trashPath)) {
        return { ok: false, message: "The trashed file is outside the app trash directory." };
    }

    try {
        await fs.rm(entry.trashPath, { recursive: true, force: true });
        await fs.rm(path.dirname(entry.trashPath), { recursive: true, force: true });
    } catch (error) {
        logger.warn("purge failed", { id, error: errorMessage(error) });
        return { ok: false, message: `Could not delete this item: ${errorMessage(error)}` };
    }

    await removeEntry(id);
    return { ok: true };
};

/** Removes a journal row without touching the file (legacy Recycle Bin rows). */
export const forgetTrashEntry = async (id: string): Promise<boolean> => removeEntry(id);

/**
 * Permanently deletes every app-trash entry whose countdown has elapsed.
 * Runs on startup and once per minute while the app is open.
 */
export const purgeExpiredTrash = async (now = Date.now()): Promise<number> => {
    const entries = await listActiveTrash();
    let purged = 0;
    for (const entry of entries) {
        if (entry.storage !== "app" || !entry.trashPath) continue;
        const expired = typeof entry.expiresAt === "number" && entry.expiresAt <= now;
        const missing = !(await pathExists(entry.trashPath));
        if (!expired && !missing) continue;
        const result = await purgeTrashEntry(entry.id);
        if (result.ok) purged += 1;
    }
    return purged;
};

/** Opens the app trash directory in Explorer/Finder. */
export const openTrashFolder = async (): Promise<void> => {
    const root = getTrashRoot();
    await fs.mkdir(root, { recursive: true });
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
};

let purgeTimer: NodeJS.Timeout | null = null;

export const startTrashScheduler = (): void => {
    if (purgeTimer) return;
    void purgeExpiredTrash().catch((error) => logger.error("initial trash purge failed", error));
    purgeTimer = setInterval(() => {
        void purgeExpiredTrash().catch((error) => logger.error("scheduled trash purge failed", error));
    }, PURGE_INTERVAL_MS);
    purgeTimer.unref();
};

export const stopTrashScheduler = (): void => {
    if (!purgeTimer) return;
    clearInterval(purgeTimer);
    purgeTimer = null;
};
