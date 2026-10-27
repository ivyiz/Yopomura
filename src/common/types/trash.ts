/** What was moved to the OS trash. */
export type TrashEntryKind = "file" | "folder";
export type TrashEntryStatus = "trashed" | "restored" | "missing";
export type TrashItemType = "manga" | "book";

/** One file or folder the app moved to the OS recycle bin / trash. */
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
};

export type RestoreTrashResult = { ok: true; entry: TrashEntry } | { ok: false; message: string };
