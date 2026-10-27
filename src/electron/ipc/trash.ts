import { getEntry, listTrashEntries, markRestored, removeEntry } from "@electron/trash/journal";
import { openRecycleBin, restoreFromRecycleBin } from "@electron/trash/recycleBin";
import { createMainLogger } from "@electron/util/logger";
import { ipc } from "./utils";

const logger = createMainLogger("ipc/trash");

export const registerTrashHandlers = (): void => {
    ipc.handle("trash:list", (_event, request) =>
        listTrashEntries({ limit: request && "limit" in request ? request.limit : undefined }),
    );

    ipc.handle("trash:restore", async (_event, { id }) => {
        const entry = await getEntry(id);
        if (!entry) return { ok: false as const, message: "Entry not found." };
        const result = await restoreFromRecycleBin(entry.originalPath);
        if (!result.ok) {
            logger.warn("restore failed", { id, path: entry.originalPath, message: result.message });
            return { ok: false as const, message: result.message };
        }
        const restored = await markRestored(id);
        return restored
            ? ({ ok: true as const, entry: restored } as const)
            : ({ ok: false as const, message: "Restored but journal update failed." } as const);
    });

    ipc.handle("trash:openRecycleBin", () => openRecycleBin());
    ipc.handle("trash:removeEntry", (_event, { id }) => removeEntry(id));
};
