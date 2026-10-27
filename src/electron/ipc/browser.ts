import { BrowserManager } from "@electron/browser/BrowserManager";
import { app, BrowserWindow } from "electron";
import { ipc } from "./utils";

const managers = new Map<number, BrowserManager>();

const managerFor = (event: Electron.IpcMainInvokeEvent): BrowserManager => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) throw new Error("Browser IPC sender is not a window");
    const existing = managers.get(window.id);
    if (existing) return existing;

    const manager = new BrowserManager({
        window,
        downloadDir: app.getPath("downloads"),
        searchEngine: "brave",
        forceDark: true,
    });
    manager.on("state", (state) => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        try {
            ipc.send(window.webContents, "browser:state", state);
        } catch {
            // window closed
        }
    });
    manager.on("context-menu", (request) => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        try {
            ipc.send(window.webContents, "browser:contextMenu", request);
        } catch {
            // window closed
        }
    });
    manager.on("download", (download) => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        try {
            ipc.send(window.webContents, "browser:download", download);
        } catch {
            // window closed
        }
    });
    manager.on("new-tab-request", (request) => {
        manager.createTab(request.url, {
            activate: request.disposition !== "background-tab",
        });
    });
    window.once("closed", () => {
        manager.destroy();
        managers.delete(window.id);
    });
    managers.set(window.id, manager);
    return manager;
};

export const registerBrowserHandlers = (): void => {
    ipc.handle("browser:getState", (event) => managerFor(event).getState());
    ipc.handle("browser:createTab", (event, { url, activate }) => ({
        id: managerFor(event).createTab(url, { activate }),
    }));
    ipc.handle("browser:closeTab", (event, { id }) => managerFor(event).closeTab(id));
    ipc.handle("browser:activateTab", (event, { id }) => managerFor(event).activateTab(id));
    ipc.handle("browser:navigate", (event, { id, input }) => managerFor(event).navigate(id, input));
    ipc.handle("browser:back", (event, { id }) => managerFor(event).back(id));
    ipc.handle("browser:forward", (event, { id }) => managerFor(event).forward(id));
    ipc.handle("browser:reload", (event, { id }) => managerFor(event).reload(id));
    ipc.handle("browser:stop", (event, { id }) => managerFor(event).stop(id));
    ipc.handle("browser:setBounds", (event, bounds) => managerFor(event).setBounds(bounds));
    ipc.handle("browser:setVisible", (event, { visible }) => {
        const window = BrowserWindow.fromWebContents(event.sender);
        const existing = window ? managers.get(window.id) : undefined;
        existing?.setVisible(visible);
    });
    ipc.handle("browser:setForceDark", (event, { enabled }) => managerFor(event).setForceDark(enabled));
    ipc.handle("browser:setHostForceDark", (event, { hostOrUrl, enabled }) =>
        managerFor(event).setHostForceDark(hostOrUrl, enabled),
    );
    ipc.handle("browser:getDisabledHosts", (event) => managerFor(event).getDisabledHosts());
    ipc.handle("browser:setSearchEngine", (event, { engine }) => managerFor(event).setSearchEngine(engine));
    ipc.handle("browser:setDownloadDir", (event, { dir }) => managerFor(event).setDownloadDir(dir));
};

export const destroyBrowserManagers = (): void => {
    for (const manager of managers.values()) manager.destroy();
    managers.clear();
};
