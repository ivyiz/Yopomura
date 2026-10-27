import type { TrashEntry } from "@common/types/trash";
import type { AppDispatch } from "@store/index";
import { addLibraryItem, fetchAllItemsWithProgress } from "@store/library";
import { materializeBookLibraryThumbnail, materializeMangaLibraryThumbnail } from "@utils/libraryCoverService";
import { createRendererLogger } from "@utils/logger";

const log = createRendererLogger("utils/trash");

export type RecoverTrashOutcome =
    | { ok: true; entry: TrashEntry; recoveredPath: string }
    | { ok: false; message: string };

export type TrashStats = { count: number; totalBytes: number };

export type EmptyTrashOutcome = { ok: true; count: number } | { ok: false; message: string };

export type SetTrashRetentionOutcome = { ok: true; entry: TrashEntry } | { ok: false; message: string };

export type RestoreAllTrashOutcome = { ok: true; count: number; failed: number } | { ok: false; message: string };

const SIZE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Compact binary size for the panel header, e.g. `0 B`, `742 KB`, `1.4 GB`. */
export const formatTrashBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
        value /= 1024;
        unit += 1;
    }
    const digits = unit === 0 || value >= 100 ? 0 : 1;
    return `${value.toFixed(digits)} ${SIZE_UNITS[unit]}`;
};

const dispatchTrashChanged = (detail: Record<string, unknown>): void => {
    window.dispatchEvent(new CustomEvent("yokomura:trash-changed", { detail }));
};

/** Reads the count and recursive on-disk size of the app trash. */
export const getTrashStats = (): Promise<TrashStats> => window.electron.invoke("trash:stats");

/**
 * Adds a recovered file/folder back to the catalogue when the trash entry knew
 * its library type. The original catalogue row was removed when the item was
 * trashed, so it is recreated at the recovered path.
 */
const importRecoveredEntry = async (dispatch: AppDispatch, entry: TrashEntry, link: string): Promise<boolean> => {
    const itemType = entry.itemType;
    if (!itemType) return false;

    try {
        const existing = await window.electron.invoke("db:library:getItem", { link });
        if (!existing) {
            const title = entry.title || window.path.basename(link, window.path.extname(link)) || entry.name;
            const added =
                itemType === "manga"
                    ? await dispatch(
                          addLibraryItem({
                              type: "manga",
                              data: {
                                  type: "manga",
                                  link,
                                  title,
                                  author: null,
                                  cover: null,
                              },
                          }),
                      ).unwrap()
                    : await dispatch(
                          addLibraryItem({
                              type: "book",
                              data: {
                                  type: "book",
                                  link,
                                  title,
                                  author: null,
                                  cover: null,
                              },
                          }),
                      ).unwrap();
            if (added.id != null) {
                if (itemType === "manga") {
                    await materializeMangaLibraryThumbnail(dispatch, added.id, link);
                } else {
                    await materializeBookLibraryThumbnail(dispatch, added.id, link);
                }
            }
        }
        return true;
    } catch (err) {
        log.warn("recovered file but library re-import failed", { entry, link }, err);
        return false;
    }
};

/**
 * Moves one Recently Deleted entry back to its original folder. If the old name
 * is occupied, the main process keeps both files under a `(recovered)` name.
 * Catalogue rows and thumbnails are rebuilt at the recovered path.
 */
export const recoverTrashEntry = async (
    dispatch: AppDispatch,
    entry: TrashEntry,
): Promise<RecoverTrashOutcome> => {
    const result = await window.electron.invoke("trash:recover", { id: entry.id });
    if (!result.ok) return result;

    dispatchTrashChanged({ kind: "recovered", entry: result.entry });

    if (entry.itemType && (await importRecoveredEntry(dispatch, entry, result.recoveredPath))) {
        await dispatch(fetchAllItemsWithProgress());
    }

    return result;
};

/** Permanently deletes one app-trash entry. */
export const deleteTrashEntry = async (
    entry: TrashEntry,
): Promise<{ ok: true } | { ok: false; message: string }> => {
    const result = await window.electron.invoke("trash:delete", { id: entry.id });
    if (result.ok) dispatchTrashChanged({ kind: "deleted", entry });
    return result;
};

/** Permanently removes every pending app-trash entry. Legacy rows stay. */
export const emptyTrash = async (): Promise<EmptyTrashOutcome> => {
    const result = await window.electron.invoke("trash:empty");
    if (result.ok) dispatchTrashChanged({ kind: "emptied", count: result.count });
    return result;
};

/** Changes one app-trash entry's countdown and recomputes its expiry. */
export const setTrashRetention = async (entry: TrashEntry, days: number): Promise<SetTrashRetentionOutcome> => {
    const result = await window.electron.invoke("trash:setRetention", { id: entry.id, days });
    if (result.ok) dispatchTrashChanged({ kind: "retention", entry: result.entry });
    return result;
};

/**
 * Finds where a recovery put a file: the original path, or the next free
 * `(recovered)` / `(recovered 2)` sibling.
 */
export const findRestoredTrashPath = (
    entry: Pick<TrashEntry, "originalPath" | "kind">,
    exists: (candidate: string) => boolean = (candidate) => window.fs.existsSync(candidate),
): string | null => {
    const original = window.path.normalize(entry.originalPath).replace(/[\\/]+$/, "");
    if (exists(original)) return original;

    const dir = window.path.dirname(original);
    const base = window.path.basename(original);
    if (entry.kind === "folder") {
        for (let index = 1; index < 20; index += 1) {
            const suffix = index === 1 ? " (recovered)" : ` (recovered ${index})`;
            const candidate = window.path.join(dir, `${base}${suffix}`);
            if (exists(candidate)) return candidate;
        }
        return null;
    }

    const extension = window.path.extname(base);
    const stem = extension ? base.slice(0, -extension.length) : base;
    for (let index = 1; index < 20; index += 1) {
        const suffix = index === 1 ? " (recovered)" : ` (recovered ${index})`;
        const candidate = window.path.join(dir, `${stem}${suffix}${extension}`);
        if (exists(candidate)) return candidate;
    }
    return null;
};

/**
 * Recovers every pending entry in one main-process sweep. Catalogue rows are
 * rebuilt for the entries that actually left the journal, then refreshed once.
 */
export const restoreAllTrash = async (
    dispatch: AppDispatch,
    entries: TrashEntry[],
): Promise<RestoreAllTrashOutcome> => {
    const result = await window.electron.invoke("trash:restoreAll");
    if (!result.ok) return result;

    dispatchTrashChanged({ kind: "restored-all", count: result.count, failed: result.failed });

    let restored = entries;
    try {
        const remaining = await window.electron.invoke("trash:list", { limit: 500 });
        const remainingIds = new Set(remaining.map((row) => row.id));
        restored = entries.filter((entry) => !remainingIds.has(entry.id));
    } catch (err) {
        log.warn("could not verify which entries were recovered; assuming all succeeded", { err });
        if (result.failed > 0) restored = [];
    }

    let touchedLibrary = false;
    for (const entry of restored) {
        if (!entry.itemType) continue;
        const link = findRestoredTrashPath(entry);
        if (!link) continue;
        touchedLibrary = (await importRecoveredEntry(dispatch, entry, link)) || touchedLibrary;
    }
    if (touchedLibrary) await dispatch(fetchAllItemsWithProgress());

    return result;
};

/** Opens the app-managed trash directory in Finder/Explorer. */
export const openTrashFolder = async (): Promise<void> => {
    await window.electron.invoke("trash:openFolder");
};
