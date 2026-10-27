import type { TrashEntry } from "@common/types/trash";
import type { AppDispatch } from "@store/index";
import { addLibraryItem, fetchAllItemsWithProgress } from "@store/library";
import { materializeBookLibraryThumbnail, materializeMangaLibraryThumbnail } from "@utils/libraryCoverService";
import { createRendererLogger } from "@utils/logger";

const log = createRendererLogger("utils/trash");

export type RestoreTrashOutcome = { ok: true; entry: TrashEntry } | { ok: false; message: string };

/**
 * Restores one journal entry from the OS recycle bin. If the entry was a catalogue
 * title, the library row and thumbnail are rebuilt after the file returns.
 */
export const restoreTrashEntry = async (
    dispatch: AppDispatch,
    entry: TrashEntry,
): Promise<RestoreTrashOutcome> => {
    const result = await window.electron.invoke("trash:restore", { id: entry.id });
    if (!result.ok) return result;

    const itemType = entry.itemType;
    if (itemType) {
        try {
            const existing = await window.electron.invoke("db:library:getItem", {
                link: result.entry.originalPath,
            });
            if (!existing) {
                const added =
                    itemType === "manga"
                        ? await dispatch(
                              addLibraryItem({
                                  type: "manga",
                                  data: {
                                      type: "manga",
                                      link: result.entry.originalPath,
                                      title: entry.title || result.entry.name,
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
                                      link: result.entry.originalPath,
                                      title: entry.title || result.entry.name,
                                      author: null,
                                      cover: null,
                                  },
                              }),
                          ).unwrap();
                if (added.id != null) {
                    if (itemType === "manga") {
                        await materializeMangaLibraryThumbnail(dispatch, added.id, result.entry.originalPath);
                    } else {
                        await materializeBookLibraryThumbnail(dispatch, added.id, result.entry.originalPath);
                    }
                }
            }
            await dispatch(fetchAllItemsWithProgress());
        } catch (err) {
            log.warn("restored file but library re-import failed", { entry }, err);
        }
    }

    return result;
};

export const openRecycleBin = async (): Promise<void> => {
    await window.electron.invoke("trash:openRecycleBin");
};
