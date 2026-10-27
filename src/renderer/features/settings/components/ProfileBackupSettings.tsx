import { dialogUtils } from "@utils/dialog";
import { createRendererLogger } from "@utils/logger";
import { useState } from "react";
import "./profileBackupSettings.scss";

const log = createRendererLogger("settings/ProfileBackupSettings");

type BusyAction = "backup" | "restore" | null;

/** True when a service result is just the user closing a native dialog. */
const isCancellation = (message: string): boolean => /cancel/i.test(message);

/** Compact byte label for the success line without adding new i18n keys. */
const formatBytes = (bytes: number): string => {
    if (!Number.isFinite(bytes) || bytes < 0) return `${bytes} bytes`;
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`;
};

/**
 * Full profile backup/restore controls.
 * Restore only stages the ZIP; the user must restart before it is applied.
 */
const ProfileBackupSettings: React.FC = () => {
    const [busy, setBusy] = useState<BusyAction>(null);
    const [message, setMessage] = useState("");
    const [error, setError] = useState("");
    const [backupPath, setBackupPath] = useState("");

    const handleBackup = async () => {
        if (busy) return;
        setBusy("backup");
        setMessage("");
        setError("");
        setBackupPath("");
        try {
            const result = await window.electron.invoke("profileBackup:create");
            if (result.ok) {
                setBackupPath(result.path);
                setMessage(`Profile backup saved (${formatBytes(result.bytes)}).`);
            } else if (isCancellation(result.message)) {
                setMessage(result.message);
            } else {
                setError(result.message);
            }
        } catch (reason) {
            log.error("profile backup failed", reason);
            setError("Could not create the profile backup.");
        } finally {
            setBusy(null);
        }
    };

    const handleRestore = async () => {
        if (busy) return;
        setMessage("");
        setError("");
        setBackupPath("");
        try {
            const { response } = await dialogUtils.warn({
                title: "Restore profile",
                message: "Restore your Yokomura profile from a ZIP backup?",
                detail: "This replaces your library database, settings, presets, shortcuts, themes, covers and trash on the next launch. Your current profile is kept in a safety folder. Yokomura must restart to finish restoring.",
                noOption: false,
                buttons: ["Cancel", "Restore profile"],
                defaultId: 0,
                cancelId: 0,
            });
            if (!response) return;

            setBusy("restore");
            const result = await window.electron.invoke("profileBackup:restore");
            if (result.ok) {
                setMessage("Restart Yokomura to finish restoring your profile.");
            } else if (isCancellation(result.message)) {
                setMessage(result.message);
            } else {
                setError(result.message);
            }
        } catch (reason) {
            log.error("profile restore staging failed", reason);
            setError("Could not stage the profile restore.");
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className="settingItem2" id="settings-profileBackup" aria-busy={busy !== null}>
            <h3>Profile backup</h3>
            <div className="desc">
                Save your library database, settings, presets, shortcuts, themes, covers and trash to a ZIP file.
                Restoring a profile replaces these files the next time Yokomura starts.
            </div>
            <div className="main row profileBackupActions">
                <button type="button" disabled={busy !== null} onClick={() => void handleBackup()}>
                    {busy === "backup" ? "Backing up…" : "Back up profile"}
                </button>
                <button type="button" disabled={busy !== null} onClick={() => void handleRestore()}>
                    {busy === "restore" ? "Restoring…" : "Restore profile"}
                </button>
            </div>
            {busy !== null && (
                <output className="desc profileBackupBusy">
                    {busy === "backup" ? "Creating profile backup…" : "Preparing profile restore…"}
                </output>
            )}
            {message && (
                <output className="desc profileBackupMessage">
                    {message}
                    {backupPath && (
                        <>
                            <br />
                            <span className="profileBackupPath">{backupPath}</span>
                        </>
                    )}
                </output>
            )}
            {error && (
                <div className="desc profileBackupError" role="alert">
                    {error}
                </div>
            )}
        </div>
    );
};

export default ProfileBackupSettings;
