import fs from "node:fs/promises";
import path from "node:path";
import * as sudo from "@vscode/sudo-prompt";
import { app } from "electron";
import { IS_PORTABLE } from ".";
import { createMainLogger } from "./logger";

const logger = createMainLogger("shelloptions");

const op = {
    name: "Yopomura",
    icns: app.getPath("exe"),
};

// registry, add option "open in reader" in  explorer context menu
export const addOptionToExplorerMenu = async (): Promise<boolean> => {
    try {
        const appPath = IS_PORTABLE
            ? app.getPath("exe").replace(/\\/g, "\\\\")
            : path.join(app.getPath("exe"), `../../${app.name}.exe`).replace(/\\/g, "\\\\");
        const regInit = `Windows Registry Editor Version 5.00
        
        ; setup context menu item for click on folders tree item
        [HKEY_CURRENT_USER\\Software\\Classes\\directory\\shell\\Yopomura\\command]
        @="\\"${appPath}\\" \\"%V\\""
        
        ; specify an icon for the item
        [HKEY_CURRENT_USER\\Software\\Classes\\directory\\shell\\Yopomura]
        @="Open in Yopomura "
        "icon"="${appPath}"

        
        [HKEY_CLASSES_ROOT\\.cbz\\shell\\Yopomura]
        @="Open in Yopomura"
        "Icon"="${appPath}"

        [HKEY_CLASSES_ROOT\\.cbz\\shell\\Yopomura\\command]
        @="\\"${appPath}\\" \\"%V\\""


        [HKEY_CLASSES_ROOT\\Yopomura]
        @="Yopomura"

        [HKEY_CLASSES_ROOT\\Yopomura\\DefaultIcon]
        @="${appPath}"

        [HKEY_CLASSES_ROOT\\Yopomura\\shell\\open]
        "Icon"="${appPath}"

        [HKEY_CLASSES_ROOT\\Yopomura\\shell\\open\\command]
        @="\\"${appPath}\\" \\"%V\\""

        [HKEY_CLASSES_ROOT\\.zip\\OpenWithProgids]
        "Yopomura"=""
        [HKEY_CLASSES_ROOT\\.cbz\\OpenWithProgids]
        "Yopomura"=""
        [HKEY_CLASSES_ROOT\\.cbr\\OpenWithProgids]
        "Yopomura"=""
        [HKEY_CLASSES_ROOT\\.cb7\\OpenWithProgids]
        "Yopomura"=""

        [HKEY_CLASSES_ROOT\\.rar\\OpenWithProgids]
        "Yopomura"=""

        [HKEY_CLASSES_ROOT\\.pdf\\OpenWithProgids]
        "Yopomura"=""

        [HKEY_CLASSES_ROOT\\.7z\\OpenWithProgids]
        "Yopomura"=""
        `;

        const tempPath = app.getPath("temp");
        const regFilePath = path.join(tempPath, "createOpenWithYopomura.reg");

        await fs.writeFile(regFilePath, regInit);

        return await new Promise<boolean>((resolve, reject) => {
            sudo.exec(`regedit.exe /S ${regFilePath}`, op, (error) => {
                if (error) {
                    logger.error("Windows Explorer 'Open in Yopomura' (folders): regedit returned error", error);
                    reject(new Error(`Failed to add explorer menu option: ${error.message}`));
                    return;
                }
                resolve(true);
            });
        });
    } catch (error) {
        logger.error("addOptionToExplorerMenu: failed before or after regedit", error);
        throw error;
    }
};

/**
 * Registers Windows Explorer "Open in Yopomura" for book files.
 */
export const addOptionToExplorerMenu_epub = async (): Promise<boolean> => {
    try {
        const appPath = IS_PORTABLE
            ? app.getPath("exe").replace(/\\/g, "\\\\")
            : path.join(app.getPath("exe"), `../../${app.name}.exe`).replace(/\\/g, "\\\\");
        const regInit = `Windows Registry Editor Version 5.00
        
        [HKEY_CLASSES_ROOT\\.epub\\shell\\Yopomura]
        @="Open in Yopomura"
        "Icon"="${appPath}"

        [HKEY_CLASSES_ROOT\\.epub\\shell\\Yopomura\\command]
        @="\\"${appPath}\\" \\"%V\\""

        [HKEY_CLASSES_ROOT\\.epub\\OpenWithProgids]
        "Yopomura"=""
        `;

        const tempPath = app.getPath("temp");
        const regFilePath = path.join(tempPath, "createOpenWithYopomura-epub.reg");

        await fs.writeFile(regFilePath, regInit);

        return await new Promise<boolean>((resolve, reject) => {
            sudo.exec(`regedit.exe /S ${regFilePath}`, op, (error) => {
                if (error) {
                    logger.error("Windows Explorer 'Open in Yopomura' (.epub): regedit returned error", error);
                    reject(new Error(`Failed to add epub explorer menu option: ${error.message}`));
                    return;
                }
                resolve(true);
            });
        });
    } catch (error) {
        logger.error("addOptionToExplorerMenu_epub: failed before or after regedit", error);
        throw error;
    }
};

export const deleteOptionInExplorerMenu = async (): Promise<boolean> => {
    try {
        const regDelete = `Windows Registry Editor Version 5.00
        
        [-HKEY_CURRENT_USER\\Software\\Classes\\directory\\shell\\Yopomura]
        
        [-HKEY_CLASSES_ROOT\\.cbz\\shell\\Yopomura]

        [-HKEY_CLASSES_ROOT\\Yopomura]

        [HKEY_CLASSES_ROOT\\.zip\\OpenWithProgids]
        "Yopomura"=-

        [HKEY_CLASSES_ROOT\\.pdf\\OpenWithProgids]
        "Yopomura"=-

        [HKEY_CLASSES_ROOT\\.7z\\OpenWithProgids]
        "Yopomura"=-
        `;

        const tempPath = app.getPath("temp");
        const regFilePath = path.join(tempPath, "deleteOpenWithYopomura.reg");

        await fs.writeFile(regFilePath, regDelete);

        return await new Promise<boolean>((resolve, reject) => {
            sudo.exec(`regedit.exe /S ${regFilePath}`, op, (error) => {
                if (error) {
                    logger.error("Windows Explorer: removing 'Open in Yopomura' registry keys failed", error);
                    reject(new Error(`Failed to delete explorer menu option: ${error.message}`));
                    return;
                }
                resolve(true);
            });
        });
    } catch (error) {
        logger.error("deleteOptionInExplorerMenu: failed before or after regedit", error);
        throw error;
    }
};

/**
 * Removes Windows Explorer "Open in Yopomura" for book files.
 * Also clears leftover Open With progids from dropped standalone text formats
 * so Remove still cleans associations added by older builds.
 */
export const deleteOptionInExplorerMenu_epub = async (): Promise<boolean> => {
    try {
        const regDelete = `Windows Registry Editor Version 5.00
        
        [-HKEY_CLASSES_ROOT\\.epub\\shell\\Yopomura]

        [HKEY_CLASSES_ROOT\\.epub\\OpenWithProgids]
        "Yopomura"=-

        [HKEY_CLASSES_ROOT\\.txt\\OpenWithProgids]
        "Yopomura"=-

        [HKEY_CLASSES_ROOT\\.xhtml\\OpenWithProgids]
        "Yopomura"=-

        [HKEY_CLASSES_ROOT\\.html\\OpenWithProgids]
        "Yopomura"=-
        `;

        const tempPath = app.getPath("temp");
        const regFilePath = path.join(tempPath, "deleteOpenWithYopomura-epub.reg");

        await fs.writeFile(regFilePath, regDelete);

        return await new Promise<boolean>((resolve, reject) => {
            sudo.exec(`regedit.exe /S ${regFilePath}`, op, (error) => {
                if (error) {
                    logger.error("Windows Explorer: removing .epub shell key failed", error);
                    reject(new Error(`Failed to delete epub explorer menu option: ${error.message}`));
                    return;
                }
                resolve(true);
            });
        });
    } catch (error) {
        logger.error("deleteOptionInExplorerMenu_epub: failed before or after regedit", error);
        throw error;
    }
};
