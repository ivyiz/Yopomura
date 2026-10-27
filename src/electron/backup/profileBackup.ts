import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createArchiveService } from "@electron/util/archive";
import { createBackup, getBackupsDir } from "@electron/util/dbBackup";
import { createMainLogger } from "@electron/util/logger";
import { app, dialog } from "electron";
import {
    collectProfileEntries,
    getProfileRestoreMarkerPath,
    getProfileRestorePendingDir,
    getProfileRestorePreviousDir,
    isExpectedProfileRestoreStagingPath,
    isPathInsideRoot,
    normalizeProfileRelativePath,
    PROFILE_BACKUP_MANIFEST,
    type ProfileBackupManifest,
    type ProfileRestoreMarker,
    profileBackupFileName,
    resolveProfileEntryPath,
    validateExtractedTree,
    validateProfileManifest,
} from "./profileBackupFiles";

const logger = createMainLogger("backup/profileBackup");

/** Prefix used for short-lived staging folders under the OS temp directory. */
const TEMP_DIR_PREFIX = "yokomura-profile-";

/** Result of writing a full profile ZIP. */
export type ProfileBackupResult = { ok: true; path: string; bytes: number } | { ok: false; message: string };

/** Result of staging a profile ZIP for the next launch. */
export type ProfileRestoreStageResult = { ok: true; restartRequired: true } | { ok: false; message: string };

/** Converts any thrown value into a user-facing message with context. */
const describeFailure = (prefix: string, error: unknown): string => {
    const detail = error instanceof Error ? error.message : String(error);
    return detail ? `${prefix}: ${detail}` : prefix;
};

/** Best-effort recursive removal of a directory we created. */
const removeDirectory = async (directory: string | null): Promise<void> => {
    if (!directory) return;
    try {
        await fsp.rm(directory, { recursive: true, force: true });
    } catch (error) {
        logger.warn("failed to remove profile staging directory", { directory }, error);
    }
};

/** Best-effort removal of a marker/partial file. */
const removeFile = async (filePath: string): Promise<void> => {
    try {
        await fsp.rm(filePath, { force: true });
    } catch (error) {
        logger.warn("failed to remove profile restore file", { filePath }, error);
    }
};

/** Appends `.zip` when the save dialog returns a name without the filter extension. */
const ensureZipExtension = (destination: string): string =>
    /\.zip$/i.test(destination) ? destination : `${destination}.zip`;

/** Copies selected profile entries from one root into another, preserving directories. */
const copyProfileEntries = async (
    sourceRoot: string,
    destinationRoot: string,
    entries: readonly string[],
    overrides: Readonly<Record<string, string>> = {},
): Promise<void> => {
    for (const entry of entries) {
        const source = overrides[entry] ?? resolveProfileEntryPath(sourceRoot, entry);
        const destination = resolveProfileEntryPath(destinationRoot, entry);
        if (!source || !destination) throw new Error(`unsafe profile entry: ${entry}`);
        if (!fs.existsSync(source)) continue;
        await fsp.mkdir(path.dirname(destination), { recursive: true });
        await fsp.cp(source, destination, { recursive: true, force: true, errorOnExist: false });
    }
};

/** Reads and validates `yokomura-profile.json` from a directory. */
const readProfileManifest = async (directory: string): Promise<ProfileBackupManifest | null> => {
    try {
        const raw = await fsp.readFile(path.join(directory, PROFILE_BACKUP_MANIFEST), "utf-8");
        const parsed: unknown = JSON.parse(raw);
        return validateProfileManifest(parsed) ? parsed : null;
    } catch {
        return null;
    }
};

/** Reads and validates the pending-restore marker. */
const readRestoreMarker = async (markerPath: string): Promise<ProfileRestoreMarker | null> => {
    try {
        const raw = await fsp.readFile(markerPath, "utf-8");
        const parsed = JSON.parse(raw) as { stagingPath?: unknown; createdAt?: unknown };
        if (
            typeof parsed.stagingPath !== "string" ||
            typeof parsed.createdAt !== "number" ||
            !Number.isFinite(parsed.createdAt)
        ) {
            return null;
        }
        return { stagingPath: parsed.stagingPath, createdAt: parsed.createdAt };
    } catch {
        return null;
    }
};

/**
 * Shows a save dialog and writes every existing profile entry plus a manifest into a ZIP.
 * User cancellation returns `ok: false` with a clear message instead of throwing.
 */
export const createProfileBackup = async (): Promise<ProfileBackupResult> => {
    const userDataPath = app.getPath("userData");
    let stagingDirectory: string | null = null;
    let destination: string | null = null;
    let destinationExisted = false;

    try {
        const entries = collectProfileEntries(userDataPath);
        if (!entries.includes("data.db")) {
            return { ok: false, message: "The profile cannot be backed up because data.db is missing." };
        }

        const saveResult = await dialog.showSaveDialog({
            title: "Back up Yokomura profile",
            defaultPath: profileBackupFileName(),
            filters: [{ name: "ZIP archive", extensions: ["zip"] }],
            properties: ["createDirectory", "showOverwriteConfirmation"],
        });
        if (saveResult.canceled || !saveResult.filePath) {
            return { ok: false, message: "Profile backup cancelled." };
        }

        destination = ensureZipExtension(saveResult.filePath);
        destinationExisted = fs.existsSync(destination);

        /*
         * data.db is copied while the connection is open; use better-sqlite3's
         * online backup so the ZIP always contains a consistent database.
         */
        const snapshot = await createBackup({ prune: false });
        if (!snapshot.ok) {
            return {
                ok: false,
                message: `Could not snapshot the library database (${snapshot.reason}).`,
            };
        }
        const snapshotPath = path.join(getBackupsDir(), snapshot.fileName);

        stagingDirectory = await fsp.mkdtemp(path.join(app.getPath("temp"), `${TEMP_DIR_PREFIX}backup-`));
        await copyProfileEntries(userDataPath, stagingDirectory, entries, { "data.db": snapshotPath });

        const manifest: ProfileBackupManifest = {
            format: 1,
            appVersion: app.getVersion(),
            createdAt: Date.now(),
            files: entries,
        };
        await fsp.writeFile(
            path.join(stagingDirectory, PROFILE_BACKUP_MANIFEST),
            JSON.stringify(manifest, null, 2),
            "utf-8",
        );

        await createArchiveService().createZip(stagingDirectory, destination);
        const { size } = await fsp.stat(destination);
        logger.log("profile backup created", { destination, bytes: size, files: entries.length });
        return { ok: true, path: destination, bytes: size };
    } catch (error) {
        logger.error("profile backup failed", error);
        if (destination && !destinationExisted) await removeFile(destination);
        return { ok: false, message: describeFailure("Could not create the profile backup", error) };
    } finally {
        await removeDirectory(stagingDirectory);
    }
};

/**
 * Prompts for a profile ZIP, extracts and validates it, then copies the payload into
 * `<userData>/profile-restore-pending` and writes the marker for the next launch.
 * Live profile files are not touched here.
 */
export const stageProfileRestore = async (): Promise<ProfileRestoreStageResult> => {
    let extractionDirectory: string | null = null;

    try {
        const pickResult = await dialog.showOpenDialog({
            title: "Restore Yokomura profile",
            properties: ["openFile"],
            filters: [{ name: "ZIP archive", extensions: ["zip"] }],
        });
        if (pickResult.canceled || !pickResult.filePaths[0]) {
            return { ok: false, message: "Profile restore cancelled." };
        }

        const archivePath = pickResult.filePaths[0];
        if (!/\.zip$/i.test(archivePath)) {
            return { ok: false, message: "Choose a Yokomura profile ZIP archive." };
        }

        extractionDirectory = await fsp.mkdtemp(path.join(app.getPath("temp"), `${TEMP_DIR_PREFIX}restore-`));
        await createArchiveService().extractAll(archivePath, extractionDirectory);
        await validateExtractedTree(extractionDirectory);

        const manifest = await readProfileManifest(extractionDirectory);
        if (!manifest) {
            return {
                ok: false,
                message: "This ZIP does not contain a valid Yokomura profile manifest.",
            };
        }

        const files = [...new Set(manifest.files.map(normalizeProfileRelativePath))];
        if (!files.includes("data.db")) {
            return { ok: false, message: "This profile backup does not contain data.db." };
        }

        const extractedDatabase = resolveProfileEntryPath(extractionDirectory, "data.db");
        if (!extractedDatabase || !fs.existsSync(extractedDatabase) || !fs.statSync(extractedDatabase).isFile()) {
            return { ok: false, message: "This profile backup does not contain a readable data.db." };
        }

        const userDataPath = app.getPath("userData");
        const pendingDirectory = getProfileRestorePendingDir(userDataPath);
        if (!isPathInsideRoot(userDataPath, pendingDirectory)) {
            return { ok: false, message: "The profile restore staging path is invalid." };
        }

        /* Drop any older marker first so a crash during staging cannot apply a partial payload. */
        await removeFile(getProfileRestoreMarkerPath(userDataPath));
        await fsp.rm(pendingDirectory, { recursive: true, force: true });
        await fsp.mkdir(pendingDirectory, { recursive: true });
        await fsp.copyFile(
            path.join(extractionDirectory, PROFILE_BACKUP_MANIFEST),
            path.join(pendingDirectory, PROFILE_BACKUP_MANIFEST),
        );
        await copyProfileEntries(extractionDirectory, pendingDirectory, files);

        const stagedDatabase = resolveProfileEntryPath(pendingDirectory, "data.db");
        if (!stagedDatabase || !fs.existsSync(stagedDatabase) || !fs.statSync(stagedDatabase).isFile()) {
            await removeDirectory(pendingDirectory);
            return { ok: false, message: "The profile payload could not be staged." };
        }

        const marker: ProfileRestoreMarker = {
            stagingPath: pendingDirectory,
            createdAt: Date.now(),
        };
        await fsp.writeFile(getProfileRestoreMarkerPath(userDataPath), JSON.stringify(marker, null, 2), "utf-8");

        logger.log("profile restore staged", {
            archivePath,
            pendingDirectory,
            files: files.length,
        });
        return { ok: true, restartRequired: true };
    } catch (error) {
        logger.error("profile restore staging failed", error);
        return { ok: false, message: describeFailure("Could not stage the profile restore", error) };
    } finally {
        await removeDirectory(extractionDirectory);
    }
};

/**
 * Applies `profile-restore-pending.json` at startup before the DB opens.
 *
 * Current profile entries are moved into `profile-restore-previous-<timestamp>/`
 * before the staged copies replace them. Missing/invalid staging clears the marker
 * so the app cannot loop. Any other failure keeps the marker for the next launch and
 * is logged; this function never throws.
 */
export const applyPendingProfileRestore = async (): Promise<boolean> => {
    const userDataPath = app.getPath("userData");
    const markerPath = getProfileRestoreMarkerPath(userDataPath);

    try {
        if (!fs.existsSync(markerPath)) return false;
        logger.log("pending profile restore marker found", { markerPath });

        const marker = await readRestoreMarker(markerPath);
        if (!marker) {
            logger.error("pending profile restore marker is unreadable; clearing", { markerPath });
            await removeFile(markerPath);
            return false;
        }

        const pendingDirectory = getProfileRestorePendingDir(userDataPath);
        if (!isExpectedProfileRestoreStagingPath(userDataPath, marker.stagingPath)) {
            logger.error("pending profile restore marker points outside its staging directory; clearing", {
                stagingPath: marker.stagingPath,
                pendingDirectory,
            });
            await removeFile(markerPath);
            return false;
        }

        if (!fs.existsSync(pendingDirectory) || !fs.lstatSync(pendingDirectory).isDirectory()) {
            logger.error("pending profile restore staging directory is missing; clearing marker", {
                pendingDirectory,
            });
            await removeFile(markerPath);
            return false;
        }

        const userDataRealPath = await fsp.realpath(userDataPath);
        const pendingRealPath = await fsp.realpath(pendingDirectory);
        if (!isPathInsideRoot(userDataRealPath, pendingRealPath)) {
            logger.error("pending profile restore staging directory resolves outside userData; clearing marker", {
                pendingDirectory,
                pendingRealPath,
            });
            await removeFile(markerPath);
            return false;
        }

        const manifestPath = path.join(pendingDirectory, PROFILE_BACKUP_MANIFEST);
        const manifest = fs.existsSync(manifestPath) ? await readProfileManifest(pendingDirectory) : null;
        if (fs.existsSync(manifestPath) && !manifest) {
            logger.error("pending profile restore manifest is invalid; clearing marker and staging", {
                pendingDirectory,
            });
            await removeFile(markerPath);
            await removeDirectory(pendingDirectory);
            return false;
        }

        const entries = manifest
            ? [...new Set(manifest.files.map(normalizeProfileRelativePath))]
            : collectProfileEntries(pendingDirectory);
        if (!entries.includes("data.db")) {
            logger.error("pending profile restore payload has no data.db; clearing marker", { pendingDirectory });
            await removeFile(markerPath);
            return false;
        }

        await validateExtractedTree(pendingDirectory);

        let previousDirectory = getProfileRestorePreviousDir(userDataPath, Date.now());
        for (let suffix = 1; fs.existsSync(previousDirectory); suffix += 1) {
            previousDirectory = getProfileRestorePreviousDir(userDataPath, Date.now() + suffix);
        }
        const previousRoot = resolveProfileEntryPath(userDataPath, path.basename(previousDirectory));
        if (!previousRoot) {
            logger.error("profile restore safety-copy path is invalid; aborting", { previousDirectory });
            return false;
        }
        await fsp.mkdir(previousRoot, { recursive: true });
        logger.log("profile restore safety copy directory created", { previousDirectory: previousRoot });

        const moveToSafetyCopy = async (target: string, entry: string): Promise<void> => {
            if (!fs.existsSync(target)) return;
            const safetyCopy = resolveProfileEntryPath(previousRoot, entry);
            if (!safetyCopy) {
                logger.error("skipping unsafe profile entry while creating safety copy", { entry });
                return;
            }
            await fsp.mkdir(path.dirname(safetyCopy), { recursive: true });
            try {
                await fsp.rename(target, safetyCopy);
            } catch {
                /* Cross-device or Windows overwrite: copy then remove. */
                await fsp.cp(target, safetyCopy, { recursive: true, force: true, errorOnExist: false });
                await fsp.rm(target, { recursive: true, force: true });
            }
            logger.log("moved current profile entry to safety copy", { entry });
        };

        for (const rawEntry of entries) {
            const entry = normalizeProfileRelativePath(rawEntry);
            const staged = resolveProfileEntryPath(pendingDirectory, entry);
            if (!staged || !fs.existsSync(staged)) {
                logger.warn("staged profile entry is missing; leaving current data in place", { entry });
                continue;
            }

            const target = resolveProfileEntryPath(userDataPath, entry);
            if (!target) {
                logger.error("skipping unsafe profile entry during restore", { entry });
                continue;
            }

            await moveToSafetyCopy(target, entry);
            if (entry === "data.db") {
                /* Stale WAL/SHM/journal must not be replayed against the restored database. */
                await moveToSafetyCopy(`${target}-wal`, "data.db-wal");
                await moveToSafetyCopy(`${target}-shm`, "data.db-shm");
                await moveToSafetyCopy(`${target}-journal`, "data.db-journal");
            }

            await fsp.mkdir(path.dirname(target), { recursive: true });
            await fsp.cp(staged, target, { recursive: true, force: true, errorOnExist: false });
            logger.log("restored profile entry", { entry });
        }

        await removeFile(markerPath);
        await removeDirectory(pendingDirectory);
        logger.log("pending profile restore applied", { previousDirectory: previousRoot });
        return true;
    } catch (error) {
        logger.error("pending profile restore failed; marker kept for a retry", error);
        return false;
    }
};
