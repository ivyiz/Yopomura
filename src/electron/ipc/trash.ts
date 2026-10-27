import {
    emptyTrash,
    forgetTrashEntry,
    getTrashStats,
    listActiveTrash,
    openTrashFolder,
    purgeExpiredTrash,
    purgeTrashEntry,
    recoverTrashEntry,
    restoreAllTrash,
    setTrashRetention,
} from "@electron/trash/trashService";
import { ipc } from "./utils";

export const registerTrashHandlers = (): void => {
    ipc.handle("trash:list", async (_event, request) => {
        const rows = await listActiveTrash();
        const limit = request && "limit" in request ? request.limit : undefined;
        if (typeof limit !== "number" || !Number.isFinite(limit)) return rows;
        return rows.slice(0, Math.max(0, Math.floor(limit)));
    });
    ipc.handle("trash:recover", (_event, { id }) => recoverTrashEntry(id));
    ipc.handle("trash:delete", (_event, { id }) => purgeTrashEntry(id));
    ipc.handle("trash:forget", (_event, { id }) => forgetTrashEntry(id));
    ipc.handle("trash:openFolder", () => openTrashFolder());
    ipc.handle("trash:purgeExpired", () => purgeExpiredTrash());
    ipc.handle("trash:empty", () => emptyTrash());
    ipc.handle("trash:stats", () => getTrashStats());
    ipc.handle("trash:setRetention", (_event, { id, days }) => setTrashRetention(id, days));
    ipc.handle("trash:restoreAll", () => restoreAllTrash());
};
