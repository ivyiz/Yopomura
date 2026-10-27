/** What was moved to the app trash. */
export type TrashEntryKind = "file" | "folder";

/** Lifecycle of a journal entry. */
export type TrashEntryStatus = "trashed" | "restored" | "missing";

/** Library classification captured at delete time, when known. */
export type TrashItemType = "manga" | "book";

/** Where the pending deletion currently lives. */
export type TrashStorage = "app" | "recycle-bin";

/** Retention choices offered in Settings, in days. */
export const TRASH_RETENTION_DAYS = [1, 3, 7, 15, 30] as const;

export type TrashRetentionDays = (typeof TRASH_RETENTION_DAYS)[number];

export const DEFAULT_TRASH_RETENTION_DAYS: TrashRetentionDays = 7;

export const isTrashRetentionDays = (value: unknown): value is TrashRetentionDays =>
    typeof value === "number" && (TRASH_RETENTION_DAYS as readonly number[]).includes(value);

/**
 * One file or folder waiting in Recently Deleted. New entries store a copy in
 * the app trash (`trashPath`); legacy entries still live in the Windows Recycle
 * Bin and only support recovery.
 */
export type TrashEntry = {
    id: string;
    originalPath: string;
    name: string;
    kind: TrashEntryKind;
    deletedAt: number;
    title?: string;
    itemType?: TrashItemType;
    status: TrashEntryStatus;
    restoredAt?: number;
    error?: string;
    /** Absolute path inside the app trash. Absent for legacy recycle-bin entries. */
    trashPath?: string;
    /** Timestamp when the item is permanently removed. Absent for legacy entries. */
    expiresAt?: number;
    /** Retention chosen when the item was deleted. */
    retentionDays?: TrashRetentionDays;
    /** Defaults to `"recycle-bin"` for entries written before the app trash existed. */
    storage: TrashStorage;
    /** Final path after a successful recovery, when it differs from `originalPath`. */
    recoveredPath?: string;
};

export type RestoreTrashResult =
    | { ok: true; entry: TrashEntry; recoveredPath: string }
    | { ok: false; message: string };

export type PurgeTrashResult = { ok: true } | { ok: false; message: string };
