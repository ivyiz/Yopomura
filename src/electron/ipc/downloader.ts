import { downloaderService } from "@electron/downloader/DownloaderService";
import { BrowserWindow } from "electron";
import { ipc } from "./utils";

/** Push the queue snapshot to every live renderer so open Downloader panels stay in sync. */
const broadcast = (): void => {
    const state = downloaderService.getState();
    for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
        try {
            ipc.send(window.webContents, "downloader:state", state);
        } catch {
            // window closed between the check and send
        }
    }
};

export const registerDownloaderHandlers = (): void => {
    downloaderService.on("state", broadcast);
    ipc.handle("downloader:getState", () => {
        downloaderService.start();
        return downloaderService.getState();
    });
    ipc.handle("downloader:add", (_event, request) => downloaderService.addJob(request));
    ipc.handle("downloader:cancel", (_event, { id }) => downloaderService.cancelJob(id));
    ipc.handle("downloader:remove", (_event, { id }) => downloaderService.removeJob(id));
    ipc.handle("downloader:clearFinished", () => downloaderService.clearFinished());
};

export const shutdownDownloader = (): void => {
    downloaderService.shutdown();
};
