import { TRASH_RETENTION_DAYS, type TrashEntry } from "@common/types/trash";
import { setAppSettings } from "@store/appSettings";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import dateUtils from "@utils/date";
import { dialogUtils } from "@utils/dialog";
import { deleteTrashEntry, openTrashFolder, recoverTrashEntry } from "@utils/trash";
import { getTrashCountdown } from "@utils/trashCountdown";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./trashPanel.scss";

type TrashPanelProps = {
    onClose: () => void;
};

const isLegacyEntry = (entry: TrashEntry): boolean => entry.storage === "recycle-bin" || !entry.trashPath;

/** Full-screen Recently Deleted panel with countdown, recovery and permanent delete. */
const TrashPanel = ({ onClose }: TrashPanelProps) => {
    const { t } = useTranslation("settings");
    const dispatch = useAppDispatch();
    const retentionDays = useAppSelector((state) => state.appSettings.trashRetentionDays);
    const [entries, setEntries] = useState<TrashEntry[]>([]);
    const [busyId, setBusyId] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        const rows = await window.electron.invoke("trash:list", { limit: 500 });
        setEntries(rows);
        setLoading(false);
    }, []);

    useEffect(() => {
        void window.electron
            .invoke("trash:purgeExpired")
            .catch(() => undefined)
            .then(() => load());
        const timer = window.setInterval(() => {
            void load();
        }, 30_000);
        const onChanged = () => void load();
        window.addEventListener("yokomura:trash-changed", onChanged);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("yokomura:trash-changed", onChanged);
        };
    }, [load]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    const recover = async (entry: TrashEntry) => {
        setBusyId(entry.id);
        setMessage("");
        const result = await recoverTrashEntry(dispatch, entry);
        setBusyId("");
        if (result.ok) {
            setMessage(
                t("trash.recoveredTo", {
                    name: window.path.basename(result.recoveredPath),
                }),
            );
        } else {
            setMessage(result.message);
        }
        await load();
    };

    const remove = async (entry: TrashEntry) => {
        const { response } = await dialogUtils.warn({
            title: t("trash.deleteConfirmTitle"),
            message: t("trash.deleteConfirmMessage", { name: entry.name }),
            detail: t("trash.deleteConfirmDetail"),
            noOption: false,
            buttons: [t("actions.cancel", { ns: "common" }), t("trash.delete")],
            defaultId: 0,
        });
        if (!response) return;

        setBusyId(entry.id);
        setMessage("");
        const result = await deleteTrashEntry(entry);
        setBusyId("");
        setMessage(result.ok ? t("trash.deletedNow", { name: entry.name }) : result.message);
        await load();
    };

    const forget = async (entry: TrashEntry) => {
        await window.electron.invoke("trash:forget", { id: entry.id });
        await load();
    };

    const changeRetention = (days: number) => {
        const value = TRASH_RETENTION_DAYS.find((row) => row === days);
        if (!value) return;
        dispatch(setAppSettings({ trashRetentionDays: value }));
        setMessage(t("trash.retentionUpdated"));
    };

    const openFolder = async () => {
        try {
            await openTrashFolder();
        } catch (err) {
            setMessage(err instanceof Error ? err.message : String(err));
        }
    };

    return (
        <div className="trashPanelOverlay" role="dialog" aria-modal="true" aria-label={t("trash.title")}>
            <div className="trashPanel">
                <header className="trashPanelHead">
                    <div>
                        <span className="trashPanelEyebrow">RECENTLY DELETED</span>
                        <h2>{t("trash.title")}</h2>
                        <p>{t("trash.desc")}</p>
                    </div>
                    <button
                        type="button"
                        className="trashPanelClose"
                        onClick={onClose}
                        aria-label={t("trash.close")}
                    >
                        ×
                    </button>
                </header>

                <div className="trashPanelToolbar">
                    <label className="trashRetention">
                        <span>{t("trash.retention")}</span>
                        <select
                            value={retentionDays}
                            onChange={(event) => changeRetention(Number(event.currentTarget.value))}
                        >
                            {TRASH_RETENTION_DAYS.map((days) => (
                                <option key={days} value={days}>
                                    {t("trash.daysOption", { count: days })}
                                </option>
                            ))}
                        </select>
                    </label>
                    <span className="trashRetentionHint">{t("trash.retentionHint")}</span>
                    <button type="button" onClick={() => void load()}>
                        {t("trash.refresh")}
                    </button>
                    <button type="button" onClick={() => void openFolder()}>
                        {t("trash.openFolder")}
                    </button>
                </div>

                {message ? <div className="trashPanelMessage">{message}</div> : null}

                <div className="trashPanelList">
                    {loading ? (
                        <p className="trashPanelEmpty">{t("trash.loading")}</p>
                    ) : entries.length === 0 ? (
                        <p className="trashPanelEmpty">{t("trash.empty")}</p>
                    ) : (
                        entries.map((entry) => {
                            const countdown = getTrashCountdown(entry.expiresAt);
                            const legacy = isLegacyEntry(entry);
                            const busy = busyId === entry.id;
                            return (
                                <article className={`trashRow ${legacy ? "is-legacy" : ""}`} key={entry.id}>
                                    <div className="trashRowMain">
                                        <div className="trashRowTitle">
                                            <strong title={entry.originalPath}>{entry.title || entry.name}</strong>
                                            {legacy ? (
                                                <span className="trashBadge">{t("trash.legacy")}</span>
                                            ) : null}
                                        </div>
                                        <span className="trashRowPath" title={entry.originalPath}>
                                            {entry.originalPath}
                                        </span>
                                        <span className="trashRowMeta">
                                            {dateUtils.format(entry.deletedAt, {
                                                format: dateUtils.presets.dateTime,
                                            })}
                                            {" · "}
                                            {legacy
                                                ? t("trash.legacyHint")
                                                : countdown?.expired
                                                  ? t("trash.expired")
                                                  : countdown && countdown.days > 0
                                                    ? t("trash.daysLeft", { count: countdown.days })
                                                    : countdown && countdown.hours > 0
                                                      ? t("trash.hoursLeft", { count: countdown.hours })
                                                      : t("trash.minutesLeft", {
                                                            count: countdown?.minutes ?? 0,
                                                        })}
                                        </span>
                                    </div>
                                    <div className="trashRowActions">
                                        <button type="button" disabled={busy} onClick={() => void recover(entry)}>
                                            {t("trash.recover")}
                                        </button>
                                        {legacy ? (
                                            <button
                                                type="button"
                                                disabled={busy}
                                                onClick={() => void forget(entry)}
                                            >
                                                {t("trash.forget")}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="is-danger"
                                                disabled={busy}
                                                onClick={() => void remove(entry)}
                                            >
                                                {t("trash.delete")}
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })
                    )}
                </div>

                <footer className="trashPanelFoot">
                    <span>{t("trash.count", { count: entries.length })}</span>
                    <button type="button" onClick={onClose}>
                        {t("trash.close")}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default TrashPanel;
