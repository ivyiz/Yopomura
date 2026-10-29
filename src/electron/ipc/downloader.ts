import type { DownloaderJob, DownloaderRecipeSummary } from "@common/types/downloader";
import { downloaderService } from "@electron/downloader/DownloaderService";
import { recipeStore } from "@electron/downloader/recipeStore";
import { notifyDownloadComplete } from "@electron/util/downloadImport";
import { BrowserWindow, dialog, shell } from "electron";
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
    downloaderService.on("job-done", (job: DownloaderJob) => {
        notifyDownloadComplete(job.outputPath || job.outDir);
    });
    ipc.handle("downloader:getState", () => {
        downloaderService.start();
        return downloaderService.getState();
    });
    ipc.handle("downloader:add", (_event, request) => downloaderService.addJob(request));
    ipc.handle("downloader:preview", (_event, { url }) => downloaderService.preview(url));
    ipc.handle("downloader:listRecipes", () => recipeStore.list());
    ipc.handle("downloader:saveRecipe", (_event, draft) => {
        try {
            const recipe = recipeStore.saveDraft(draft);
            if (!recipe)
                return { ok: false as const, message: "Recipe needs an id and an image selector or script" };
            return {
                ok: true as const,
                recipe: {
                    id: recipe.id,
                    name: recipe.name || recipe.id,
                    hosts: recipe.match,
                    mode: recipe.mode || "auto",
                    file: `${recipe.id}.json`,
                },
            };
        } catch (error) {
            return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    });
    ipc.handle("downloader:importRecipe", async (event) => {
        const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
        const options: Electron.OpenDialogOptions = {
            title: "Import downloader recipe",
            filters: [{ name: "Recipe JSON", extensions: ["json"] }],
            properties: ["openFile"],
        };
        const picked = window
            ? await dialog.showOpenDialog(window, options)
            : await dialog.showOpenDialog(options);
        if (picked.canceled || picked.filePaths.length === 0) {
            return { ok: false as const, message: "Import cancelled" };
        }
        try {
            const recipe = recipeStore.importFile(picked.filePaths[0]);
            if (!recipe) return { ok: false as const, message: "Invalid recipe file" };
            const summary: DownloaderRecipeSummary = {
                id: recipe.id,
                name: recipe.name || recipe.id,
                hosts: recipe.match,
                mode: recipe.mode || "auto",
                file: `${recipe.id}.json`,
            };
            return { ok: true as const, recipe: summary };
        } catch (error) {
            return {
                ok: false as const,
                message: error instanceof Error ? error.message : String(error),
            };
        }
    });
    ipc.handle("downloader:deleteRecipe", (_event, { id }) => recipeStore.remove(id));
    ipc.handle("downloader:openRecipeFolder", () => {
        void shell.openPath(recipeStore.folder());
    });
    ipc.handle("downloader:cancel", (_event, { id }) => downloaderService.cancelJob(id));
    ipc.handle("downloader:pause", () => downloaderService.pause());
    ipc.handle("downloader:resume", () => downloaderService.resume());
    ipc.handle("downloader:remove", (_event, { id }) => downloaderService.removeJob(id));
    ipc.handle("downloader:clearFinished", () => downloaderService.clearFinished());
};

export const shutdownDownloader = (): void => {
    downloaderService.shutdown();
};
