import {
    applyPendingProfileRestore,
    createProfileBackup,
    stageProfileRestore,
} from "@electron/backup/profileBackup";
import { ipc } from "./utils";

/**
 * Registers full profile backup/restore IPC.
 * `applyPendingProfileRestore` is a startup hook and is intentionally not called here.
 */
export const registerProfileBackupHandlers = (): void => {
    ipc.handle("profileBackup:create", () => createProfileBackup());
    ipc.handle("profileBackup:restore", () => stageProfileRestore());
};

/** Re-exported so the main process can wire the pre-DB startup hook from one module. */
export { applyPendingProfileRestore };
