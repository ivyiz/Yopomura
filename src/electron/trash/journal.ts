import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
    isTrashRetentionDays,
    type TrashEntry,
    type TrashEntryKind,
    type TrashEntryStatus,
    type TrashItemType,
    type TrashStorage,
} from "@common/types/trash";
import { createMainLogger } from "@electron/util/logger";
import { app } from "electron";

const logger = createMainLogger("trash/journal");

/** Journal filename inside a base directory (normally `app.getPath("userData")`). */
export const TRASH_JOURNAL_FILE = "trash-journal.json";

/** Fields accepted by {@link TrashJournal.appendTrashEntry}. */
export type AppendTrashEntryInput = {
    originalPath: string;
    /** Defaults to `basename(originalPath)`. */
    name?: string;
    kind: TrashEntryKind;
    /** Defaults to `Date.now()`. */
    deletedAt?: number;
    title?: string;
    itemType?: TrashItemType;
    /** Defaults to `"trashed"`. */
    status?: TrashEntryStatus;
    restoredAt?: number;
    error?: string;
    /** Absolute path inside the app trash. */
    trashPath?: string;
    /** Absolute timestamp when the item is permanently removed. */
    expiresAt?: number;
    retentionDays?: number;
    /** Defaults to `"recycle-bin"` so old journals keep working. */
    storage?: TrashStorage;
    recoveredPath?: string;
    /** Mostly for re-importing an existing journal; defaults to a random UUID. */
    id?: string;
};

/** Fields that can be changed on an existing journal row. */
export type UpdateTrashEntryPatch = Partial<Omit<TrashEntry, "id">>;

/** Options for {@link TrashJournal.listTrashEntries}. */
export type ListTrashEntriesOptions = {
    /** Keep at most this many of the newest entries. */
    limit?: number;
};

/** Journal API bound to one base directory. */
export type TrashJournal = {
    /** Absolute path of the JSON journal. */
    readonly filePath: string;
    /** Adds an entry and returns the record as written to disk. */
    appendTrashEntry: (input: AppendTrashEntryInput) => Promise<TrashEntry>;
    /** Entries newest-first, optionally capped by `limit`. */
    listTrashEntries: (options?: ListTrashEntriesOptions) => Promise<TrashEntry[]>;
    /** Marks an entry restored. Returns `null` when the id is unknown. */
    markRestored: (id: string) => Promise<TrashEntry | null>;
    /** Deletes an entry. Returns false when the id is unknown. */
    removeEntry: (id: string) => Promise<boolean>;
    /**
     * Drops entries whose `deletedAt` is older than `ms` before `now` (default: current time).
     * @returns number of entries removed
     */
    pruneOlderThan: (ms: number, now?: number) => Promise<number>;
    /** Returns one entry, or `null` when the id is unknown. */
    getEntry: (id: string) => Promise<TrashEntry | null>;
    /**
     * Merges `patch` into one entry and persists it.
     * @returns the updated entry, or `null` when the id is unknown
     */
    updateEntry: (id: string, patch: UpdateTrashEntryPatch) => Promise<TrashEntry | null>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const isKind = (value: unknown): value is TrashEntryKind => value === "file" || value === "folder";

const isStatus = (value: unknown): value is TrashEntryStatus =>
    value === "trashed" || value === "restored" || value === "missing";

const isItemType = (value: unknown): value is TrashItemType => value === "manga" || value === "book";

const optionalString = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/**
 * Accepts an array or a legacy `{ entries: [...] }` envelope. Malformed rows are
 * dropped so one bad record cannot make the whole journal unreadable.
 */
const parseJournal = (raw: string): TrashEntry[] | null => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    } catch {
        return null;
    }
    const rows = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.entries)
          ? parsed.entries
          : null;
    if (!rows) return null;

    const entries: TrashEntry[] = [];
    for (const row of rows) {
        if (!isRecord(row)) continue;
        if (typeof row.id !== "string" || row.id.length === 0) continue;
        if (typeof row.originalPath !== "string" || row.originalPath.length === 0) continue;
        if (typeof row.deletedAt !== "number" || !Number.isFinite(row.deletedAt)) continue;

        const entry: TrashEntry = {
            id: row.id,
            originalPath: row.originalPath,
            name:
                typeof row.name === "string" && row.name.length > 0
                    ? row.name
                    : path.basename(row.originalPath) || row.originalPath,
            kind: isKind(row.kind) ? row.kind : "file",
            deletedAt: row.deletedAt,
            status: isStatus(row.status) ? row.status : "trashed",
            storage: row.storage === "app" || typeof row.trashPath === "string" ? "app" : "recycle-bin",
        };
        const title = optionalString(row.title);
        if (title !== undefined) entry.title = title;
        if (isItemType(row.itemType)) entry.itemType = row.itemType;
        if (typeof row.restoredAt === "number" && Number.isFinite(row.restoredAt))
            entry.restoredAt = row.restoredAt;
        const error = optionalString(row.error);
        if (error !== undefined) entry.error = error;
        const trashPath = optionalString(row.trashPath);
        if (trashPath !== undefined) entry.trashPath = trashPath;
        if (typeof row.expiresAt === "number" && Number.isFinite(row.expiresAt)) entry.expiresAt = row.expiresAt;
        if (isTrashRetentionDays(row.retentionDays)) entry.retentionDays = row.retentionDays;
        const recoveredPath = optionalString(row.recoveredPath);
        if (recoveredPath !== undefined) entry.recoveredPath = recoveredPath;
        entries.push(entry);
    }
    return entries;
};

/** Shortest useful error text for a log line. */
const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Merges a patch into a row without letting it drop the id or write invalid
 * values. `undefined` patch fields mean "leave this field alone".
 */
const applyUpdate = (current: TrashEntry, patch: UpdateTrashEntryPatch): TrashEntry => {
    if (!isRecord(patch)) throw new TypeError("updateEntry: patch must be an object");
    if (patch.retentionDays !== undefined && !isTrashRetentionDays(patch.retentionDays)) {
        throw new TypeError("updateEntry: retentionDays must be 1, 3, 7, 15, or 30");
    }
    if (patch.status !== undefined && !isStatus(patch.status)) {
        throw new TypeError('updateEntry: status must be "trashed", "restored", or "missing"');
    }
    if (patch.kind !== undefined && !isKind(patch.kind)) {
        throw new TypeError('updateEntry: kind must be "file" or "folder"');
    }
    if (patch.deletedAt !== undefined && !isFiniteNumber(patch.deletedAt)) {
        throw new TypeError("updateEntry: deletedAt must be a finite number");
    }
    if (patch.expiresAt !== undefined && !isFiniteNumber(patch.expiresAt)) {
        throw new TypeError("updateEntry: expiresAt must be a finite number");
    }

    const next: TrashEntry = { ...current };
    const mutable = next as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(patch)) {
        if (key === "id" || value === undefined) continue;
        mutable[key] = value;
    }
    return next;
};

/**
 * Creates a journal rooted at `baseDir`. All operations on one instance run
 * through a promise queue, so concurrent appends cannot overwrite each other.
 */
export const createTrashJournal = (baseDir: string): TrashJournal => {
    const filePath = path.join(baseDir, TRASH_JOURNAL_FILE);

    let queue: Promise<unknown> = Promise.resolve();
    const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
        const run = queue.then(work, work);
        queue = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    };

    let tempCounter = 0;

    /** Temp sibling + rename, keeping the old journal valid until the swap. */
    const writeEntries = async (entries: TrashEntry[]): Promise<void> => {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.${process.pid}.${++tempCounter}.tmp`;
        const body = `${JSON.stringify(entries, null, 2)}\n`;
        try {
            await fs.writeFile(tempPath, body, { encoding: "utf8", flag: "w" });
            try {
                await fs.rename(tempPath, filePath);
            } catch (renameError) {
                /* Windows can refuse to replace an existing file; unlink first. */
                logger.warn("trash journal rename failed; retrying after unlink", {
                    filePath,
                    renameError: errorMessage(renameError),
                });
                await fs.rm(filePath, { force: true });
                await fs.rename(tempPath, filePath);
            }
        } finally {
            await fs.rm(tempPath, { force: true }).catch(() => undefined);
        }
    };

    /** Reads the journal, recreating it as an empty array when absent or corrupt. */
    const readEntries = async (): Promise<TrashEntry[]> => {
        let raw: string;
        try {
            raw = await fs.readFile(filePath, "utf8");
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code !== "ENOENT") {
                logger.warn("trash journal is unreadable; recreating", {
                    filePath,
                    error: errorMessage(error),
                });
            }
            try {
                await writeEntries([]);
            } catch (writeError) {
                if (code !== "ENOENT") {
                    logger.error("failed to recreate trash journal", {
                        filePath,
                        error: errorMessage(writeError),
                    });
                }
            }
            return [];
        }

        const entries = parseJournal(raw);
        if (entries) return entries;

        logger.warn("trash journal is corrupt; recreating", { filePath });
        try {
            await writeEntries([]);
        } catch (writeError) {
            logger.error("failed to recreate corrupt trash journal", {
                filePath,
                error: errorMessage(writeError),
            });
        }
        return [];
    };

    const sortNewestFirst = (entries: TrashEntry[]): TrashEntry[] =>
        [...entries].sort((a, b) => b.deletedAt - a.deletedAt);

    const appendTrashEntry = (input: AppendTrashEntryInput): Promise<TrashEntry> =>
        enqueue(async () => {
            if (!input || typeof input.originalPath !== "string" || input.originalPath.trim().length === 0) {
                throw new TypeError("appendTrashEntry: originalPath must be a non-empty string");
            }
            if (!isKind(input.kind)) {
                throw new TypeError('appendTrashEntry: kind must be "file" or "folder"');
            }
            const now = Date.now();
            const entry: TrashEntry = {
                id: typeof input.id === "string" && input.id.length > 0 ? input.id : randomUUID(),
                originalPath: input.originalPath,
                name:
                    typeof input.name === "string" && input.name.length > 0
                        ? input.name
                        : path.basename(input.originalPath) || input.originalPath,
                kind: input.kind,
                deletedAt:
                    typeof input.deletedAt === "number" && Number.isFinite(input.deletedAt)
                        ? input.deletedAt
                        : now,
                status: isStatus(input.status) ? input.status : "trashed",
                storage: input.storage === "app" ? "app" : "recycle-bin",
            };
            if (typeof input.title === "string") entry.title = input.title;
            if (isItemType(input.itemType)) entry.itemType = input.itemType;
            if (typeof input.restoredAt === "number" && Number.isFinite(input.restoredAt)) {
                entry.restoredAt = input.restoredAt;
            }
            if (typeof input.error === "string") entry.error = input.error;
            if (typeof input.trashPath === "string" && input.trashPath.length > 0) {
                entry.trashPath = input.trashPath;
            }
            if (typeof input.expiresAt === "number" && Number.isFinite(input.expiresAt)) {
                entry.expiresAt = input.expiresAt;
            }
            if (isTrashRetentionDays(input.retentionDays)) {
                entry.retentionDays = input.retentionDays;
            }
            if (typeof input.recoveredPath === "string" && input.recoveredPath.length > 0) {
                entry.recoveredPath = input.recoveredPath;
            }

            const entries = await readEntries();
            entries.push(entry);
            await writeEntries(entries);
            return entry;
        });

    const listTrashEntries = (options?: ListTrashEntriesOptions): Promise<TrashEntry[]> =>
        enqueue(async () => {
            const entries = sortNewestFirst(await readEntries());
            if (typeof options?.limit !== "number" || !Number.isFinite(options.limit)) return entries;
            return entries.slice(0, Math.max(0, Math.floor(options.limit)));
        });

    const markRestored = (id: string): Promise<TrashEntry | null> =>
        enqueue(async () => {
            const entries = await readEntries();
            const index = entries.findIndex((entry) => entry.id === id);
            if (index === -1) return null;

            const current = entries[index];
            if (!current) return null;
            const restored: TrashEntry = {
                ...current,
                status: "restored",
                restoredAt: Date.now(),
            };
            delete restored.error;
            entries[index] = restored;
            await writeEntries(entries);
            return restored;
        });

    const removeEntry = (id: string): Promise<boolean> =>
        enqueue(async () => {
            const entries = await readEntries();
            const next = entries.filter((entry) => entry.id !== id);
            if (next.length === entries.length) return false;
            await writeEntries(next);
            return true;
        });

    const pruneOlderThan = (ms: number, now = Date.now()): Promise<number> =>
        enqueue(async () => {
            if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) {
                throw new TypeError("pruneOlderThan: ms must be a non-negative finite number");
            }
            const cutoff = now - ms;
            const entries = await readEntries();
            const next = entries.filter((entry) => entry.deletedAt >= cutoff);
            if (next.length === entries.length) return 0;
            await writeEntries(next);
            return entries.length - next.length;
        });

    const getEntry = (id: string): Promise<TrashEntry | null> =>
        enqueue(async () => {
            const entries = await readEntries();
            return entries.find((entry) => entry.id === id) ?? null;
        });

    const updateEntry = (id: string, patch: UpdateTrashEntryPatch): Promise<TrashEntry | null> =>
        enqueue(async () => {
            const entries = await readEntries();
            const index = entries.findIndex((entry) => entry.id === id);
            if (index === -1) return null;

            const current = entries[index];
            if (!current) return null;
            const updated = applyUpdate(current, patch);
            entries[index] = updated;
            await writeEntries(entries);
            return updated;
        });

    return {
        filePath,
        appendTrashEntry,
        listTrashEntries,
        markRestored,
        removeEntry,
        pruneOlderThan,
        getEntry,
        updateEntry,
    };
};

let defaultJournal: TrashJournal | null = null;

/** Lazily binds the module-level helpers to `app.getPath("userData")`. */
export const getDefaultTrashJournal = (): TrashJournal => {
    defaultJournal ??= createTrashJournal(app.getPath("userData"));
    return defaultJournal;
};

/** Default journal entry append (userData). Use {@link createTrashJournal} to isolate a caller. */
export const appendTrashEntry = (input: AppendTrashEntryInput): Promise<TrashEntry> =>
    getDefaultTrashJournal().appendTrashEntry(input);

/** Default journal listing, newest-first. */
export const listTrashEntries = (options?: ListTrashEntriesOptions): Promise<TrashEntry[]> =>
    getDefaultTrashJournal().listTrashEntries(options);

/** Default journal restore marker. */
export const markRestored = (id: string): Promise<TrashEntry | null> => getDefaultTrashJournal().markRestored(id);

/** Default journal entry removal. */
export const removeEntry = (id: string): Promise<boolean> => getDefaultTrashJournal().removeEntry(id);

/** Default journal age-based pruning. */
export const pruneOlderThan = (ms: number, now?: number): Promise<number> =>
    getDefaultTrashJournal().pruneOlderThan(ms, now);

/** Default journal single-entry lookup. */
export const getEntry = (id: string): Promise<TrashEntry | null> => getDefaultTrashJournal().getEntry(id);

/** Default journal single-entry patch update. */
export const updateEntry = (id: string, patch: UpdateTrashEntryPatch): Promise<TrashEntry | null> =>
    getDefaultTrashJournal().updateEntry(id, patch);
