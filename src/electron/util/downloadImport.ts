import fs from "node:fs";
import path from "node:path";
import { getDefaultLocationPath, type LibraryFolder } from "@common/library/folders";
import { isBookFileName, isMangaFileName, VIDEO_DOWNLOAD_FOLDER_NAME } from "@common/library/formats";
import { app } from "electron";
import { startLibraryScan } from "./libraryScan";
import { createMainLogger } from "./logger";
import { MainSettings } from "./mainSettings";

const log = createMainLogger("downloadImport");

/** Fallback directory when no library Default Location is configured. */
export const APP_DOWNLOAD_DIR_NAME = "downloads";

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
const pendingRoots = new Set<string>();

const libraryFolders = (): LibraryFolder[] => {
    try {
        return MainSettings.settings.library.folders;
    } catch (error) {
        log.warn("main settings unavailable while resolving download folder", error);
        return [];
    }
};

/** Directory used for browser and downloader output. Prefers the library
 * Default Location so finished files show up in Location, Library and Media
 * without a second copy. Falls back to `<userData>/downloads`.
 */
export const resolveDownloadDir = (): string => {
    const root = getDefaultLocationPath(libraryFolders());
    const dir = root || path.join(app.getPath("userData"), APP_DOWNLOAD_DIR_NAME);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
        log.warn("could not create download directory", dir, error);
    }
    return dir;
};

/** Videos are not manga: keep browser video downloads out of the library root. */
export const resolveVideoDownloadDir = (): string => {
    const dir = path.join(app.getPath("videos"), VIDEO_DOWNLOAD_FOLDER_NAME);
    try {
        fs.mkdirSync(dir, { recursive: true });
    } catch (error) {
        log.warn("could not create video download directory", dir, error);
    }
    return dir;
};

/** Longest registered library root containing `targetPath`, if any. */
const registeredRootFor = (targetPath: string): string | null => {
    const target = path.resolve(targetPath);
    let best: string | null = null;
    for (const folder of libraryFolders()) {
        const root = path.resolve(folder.path);
        if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
        if (!best || root.length > best.length) best = root;
    }
    return best;
};

/** Videos and loose images are Media-only; archives, books, PDFs and folders go to the catalogue. */
const isLibraryDownload = (targetPath: string): boolean => {
    try {
        if (fs.statSync(targetPath).isDirectory()) return true;
    } catch {
        // The worker may have removed a temporary path; fall through to extension checks.
    }
    return isMangaFileName(targetPath) || isBookFileName(targetPath);
};

const runImport = async (roots: string[], attempt = 0): Promise<void> => {
    const existing = roots.filter((root) => fs.existsSync(root));
    if (existing.length === 0) return;

    const result = await startLibraryScan({ reason: "watch", paths: existing });
    if (result.started || result.cancelled || attempt >= 4) return;

    // A manual scan may already be walking; retry after it settles.
    const timer = setTimeout(() => {
        void runImport(existing, attempt + 1);
    }, 5000);
    timer.unref?.();
};

/**
 * Queues a library scan for the registered root that received a download.
 * Coalesces bursts (gallery ZIP + cover, several scans) into one scan.
 */
export const scheduleLibraryImport = (root: string): void => {
    pendingRoots.add(path.normalize(root));
    if (pendingTimer) clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
        pendingTimer = null;
        const roots = [...pendingRoots];
        pendingRoots.clear();
        void runImport(roots).catch((error: unknown) =>
            log.warn("could not import downloaded files into the library", error),
        );
    }, 2500);
    pendingTimer.unref?.();
};

/** Called when a browser download or downloader job finishes. */
export const notifyDownloadComplete = (targetPath: string): void => {
    const target = targetPath.trim();
    if (!target) return;
    if (!isLibraryDownload(target)) return;

    const root = registeredRootFor(target);
    if (!root) return;
    scheduleLibraryImport(root);
};
