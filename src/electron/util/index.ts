import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow } from "electron";
import { createMainLogger, setupMainProcessLogging } from "./logger";

export const IS_PORTABLE =
    app.isPackaged &&
    process.platform === "win32" &&
    !app.getAppPath().includes(path.dirname(app.getPath("appData")));

if (IS_PORTABLE) {
    const folderPath = path.join(app.getAppPath(), "../../userdata/");
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath);
    }
    app.setPath("userData", folderPath);
}

/**
 * One-time carry-over when the product name changes (Yomikiru -> Yokomura).
 * Copies the catalogue, settings, and cached covers into the new userData folder
 * without overwriting anything already there. Portable builds land beside the exe;
 * installed builds land under appData/Yokomura.
 */
const migrateLegacyUserData = (): void => {
    const target = app.getPath("userData");
    const legacy = path.join(app.getPath("appData"), "Yomikiru");
    if (path.resolve(target).toLowerCase() === path.resolve(legacy).toLowerCase()) return;
    if (!fs.existsSync(legacy) || fs.existsSync(path.join(target, "data.db"))) return;

    try {
        fs.mkdirSync(target, { recursive: true });
        const files = [
            "data.db",
            "data.db-wal",
            "data.db-shm",
            "main-settings.json",
            "settings.json",
            "reader-presets.json",
            "shortcuts.json",
            "themes.json",
            "announcements.txt",
        ];
        for (const name of files) {
            const source = path.join(legacy, name);
            if (!fs.existsSync(source)) continue;
            fs.cpSync(source, path.join(target, name), { force: false });
        }
        for (const name of ["covers", "i18n-packs"]) {
            const source = path.join(legacy, name);
            if (!fs.existsSync(source)) continue;
            fs.cpSync(source, path.join(target, name), {
                recursive: true,
                force: false,
                errorOnExist: false,
            });
        }
        console.log(`[Yokomura] carried over existing data from ${legacy}`);
    } catch (error) {
        console.error("[Yokomura] legacy data migration failed", error);
    }
};

if (!IS_PORTABLE) migrateLegacyUserData();

// change path in `settings.tsx` as well if changing log path
//! This needs to be called after new `userData` is set
setupMainProcessLogging(() => app.getPath("userData"));

const saveFileLogger = createMainLogger("util/saveFile");

export const saveFile = (path: string, data: string, sync = true, retry = 3): void => {
    try {
        if (sync) {
            fs.writeFileSync(path, data);
        } else
            fs.writeFile(path, data, (err) => {
                if (err) {
                    throw err;
                }
            });
    } catch (err) {
        saveFileLogger.error(`Failed to write "${path}" (${retry - 1} retries left)`, err);
        if (retry > 0)
            setTimeout(() => {
                saveFile(path, data, sync, retry - 1);
            }, 1000);
    }
};

export const electronOnly = (): void => {
    if (process.type === "renderer") throw new Error("This function is only available in the main process.");
};

export const getWindowFromWebContents = (webContents: Electron.WebContents): BrowserWindow => {
    const win = BrowserWindow.fromWebContents(webContents);
    // to avoid typescript errors because in most cases it will never be null
    if (!win) {
        throw new Error("BrowserWindow not found");
    }
    return win;
};

/**
 * old formatting used `new Date().toLocaleString("en-UK", { hour12: true })`
 */
export const dateFromOldDateString = (localeDate?: string): Date => {
    if (!localeDate) return new Date();
    const [date, time] = localeDate.split(", ");
    const [day, month, year] = date.split("/");
    const newString = `${year}-${month}-${day} ${time}`;
    return new Date(newString);
};

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isArchLinux = () => fs.existsSync("/etc/arch-release");
