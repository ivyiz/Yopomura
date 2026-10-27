import type { TrashEntry } from "@common/types/trash";
import type { AppDispatch } from "@store/index";
import { addLibraryItem, fetchAllItemsWithProgress } from "@store/library";
import { materializeBookLibraryThumbnail, materializeMangaLibraryThumbnail } from "@utils/libraryCoverService";
import { createRendererLogger } from "@utils/logger";

const log = createRendererLogger("utils/trash");

export type RecoverTrashOutcome =
    | { ok: true; entry: TrashEntry; recoveredPath: string }
    | { ok: false; message: string };

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

    window.dispatchEvent(
        new CustomEvent("yokomura:trash-changed", { detail: { kind: "recovered", entry: result.entry } }),
    );

    const itemType = entry.itemType;
    if (itemType) {
        try {
            const link = result.recoveredPath;
            const existing = await window.electron.invoke("db:library:getItem", { link });
            if (!existing) {
                const title =
                    entry.title || window.path.basename(link, window.path.extname(link)) || result.entry.name;
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
            await dispatch(fetchAllItemsWithProgress());
        } catch (err) {
            log.warn("recovered file but library re-import failed", { entry }, err);
        }
    }

    return result;
};

/** Permanently deletes one app-trash entry. */
export const deleteTrashEntry = async (
    entry: TrashEntry,
): Promise<{ ok: true } | { ok: false; message: string }> => {
    const result = await window.electron.invoke("trash:delete", { id: entry.id });
    if (result.ok) {
        window.dispatchEvent(new CustomEvent("yokomura:trash-changed", { detail: { kind: "deleted", entry } }));
    }
    return result;
};

/** Opens the app-managed trash directory in Finder/Explorer. */
export const openTrashFolder = async (): Promise<void> => {
    await window.electron.invoke("trash:openFolder");
};
