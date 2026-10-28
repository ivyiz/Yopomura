import { TRASH_RETENTION_DAYS, type TrashEntry } from "@common/types/trash";
import { setAppSettings } from "@store/appSettings";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import dateUtils from "@utils/date";
import { dialogUtils } from "@utils/dialog";
import {
    deleteTrashEntry,
    emptyTrash,
    formatTrashBytes,
    getTrashStats,
    openTrashFolder,
    recoverTrashEntry,
    restoreAllTrash,
    setTrashRetention,
    type TrashStats,
} from "@utils/trash";
import { getTrashCountdown } from "@utils/trashCountdown";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "./trashPanel.scss";

type TrashPanelProps = {
    onClose: () => void;
};

type BulkBusy = "" | "refresh" | "open" | "restoreAll" | "empty";

const EMPTY_STATS: TrashStats = { count: 0, totalBytes: 0 };

const isLegacyEntry = (entry: TrashEntry): boolean => entry.storage === "recycle-bin" || !entry.trashPath;

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Full-screen Recently Deleted panel with stats, search, bulk actions and countdowns. */
const TrashPanel = ({ onClose }: TrashPanelProps) => {
    const { t } = useTranslation("settings");
    const dispatch = useAppDispatch();
    const retentionDays = useAppSelector((state) => state.appSettings.trashRetentionDays);
    const [entries, setEntries] = useState<TrashEntry[]>([]);
    const [stats, setStats] = useState<TrashStats>(EMPTY_STATS);
    const [query, setQuery] = useState("");
    const [busyId, setBusyId] = useState("");
    const [bulkBusy, setBulkBusy] = useState<BulkBusy>("");
    const [message, setMessage] = useState("");
    const [isError, setIsError] = useState(false);
    const [loading, setLoading] = useState(true);

    const notify = useCallback((text: string, error = false) => {
        setMessage(text);
        setIsError(error);
    }, []);

    const load = useCallback(async () => {
        try {
            const [rows, nextStats] = await Promise.all([
                window.electron.invoke("trash:list", { limit: 500 }),
                getTrashStats().catch(() => null),
            ]);
            setEntries(rows);
            setStats(nextStats ?? { count: rows.length, totalBytes: 0 });
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setLoading(false);
        }
    }, [notify]);

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

    const visibleEntries = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return entries;
        return entries.filter((entry) =>
            `${entry.title ?? ""}\n${entry.name}\n${entry.originalPath}`.toLowerCase().includes(needle),
        );
    }, [entries, query]);

    const appEntryCount = useMemo(() => entries.filter((entry) => !isLegacyEntry(entry)).length, [entries]);
    const actionsBusy = bulkBusy !== "" || busyId !== "";

    const refresh = async () => {
        setBulkBusy("refresh");
        await load();
        setBulkBusy("");
    };

    const recover = async (entry: TrashEntry) => {
        setBusyId(entry.id);
        setMessage("");
        setIsError(false);
        try {
            const result = await recoverTrashEntry(dispatch, entry);
            if (result.ok) {
                notify(
                    t("trash.recoveredTo", {
                        name: window.path.basename(result.recoveredPath),
                    }),
                );
            } else {
                notify(result.message, true);
            }
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setBusyId("");
            await load();
        }
    };

    const remove = async (entry: TrashEntry) => {
        const { response } = await dialogUtils.warn({
            title: t("trash.deleteConfirmTitle"),
            message: t("trash.deleteConfirmMessage", { name: entry.name }),
            detail: t("trash.deleteConfirmDetail"),
            noOption: false,
            buttons: [t("actions.cancel", { ns: "common" }), t("trash.delete")],
            defaultId: 0,
            cancelId: 0,
        });
        if (!response) return;

        setBusyId(entry.id);
        setMessage("");
        setIsError(false);
        try {
            const result = await deleteTrashEntry(entry);
            notify(result.ok ? t("trash.deletedNow", { name: entry.name }) : result.message, !result.ok);
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setBusyId("");
            await load();
        }
    };

    const forget = async (entry: TrashEntry) => {
        setBusyId(entry.id);
        setMessage("");
        setIsError(false);
        try {
            await window.electron.invoke("trash:forget", { id: entry.id });
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setBusyId("");
            await load();
        }
    };

    const changeRetention = (entry: TrashEntry, days: number) => {
        const value = TRASH_RETENTION_DAYS.find((row) => row === days);
        if (!value) return;

        void (async () => {
            setBusyId(entry.id);
            setMessage("");
            setIsError(false);
            try {
                const result = await setTrashRetention(entry, value);
                notify(
                    result.ok
                        ? t("trash.itemRetentionUpdated", {
                              name: entry.title || entry.name,
                          })
                        : result.message,
                    !result.ok,
                );
            } catch (err) {
                notify(errorText(err), true);
            } finally {
                setBusyId("");
                await load();
            }
        })();
    };

    const changeDefaultRetention = (days: number) => {
        const value = TRASH_RETENTION_DAYS.find((row) => row === days);
        if (!value) return;
        dispatch(setAppSettings({ trashRetentionDays: value }));
        notify(t("trash.retentionUpdated"));
    };

    const restoreEverything = async () => {
        if (entries.length === 0) return;
        const { response } = await dialogUtils.warn({
            title: t("trash.restoreAllConfirmTitle"),
            message: t("trash.restoreAllConfirmMessage", { count: entries.length }),
            detail: t("trash.restoreAllConfirmDetail"),
            noOption: false,
            buttons: [t("actions.cancel", { ns: "common" }), t("trash.restoreAll")],
            defaultId: 0,
            cancelId: 0,
        });
        if (!response) return;

        setBulkBusy("restoreAll");
        setMessage("");
        setIsError(false);
        try {
            const result = await restoreAllTrash(dispatch, entries);
            if (!result.ok) {
                notify(result.message, true);
            } else if (result.failed > 0) {
                notify(t("trash.restoreAllPartial", { count: result.count, failed: result.failed }), true);
            } else {
                notify(t("trash.restoreAllDone", { count: result.count }));
            }
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setBulkBusy("");
            await load();
        }
    };

    const emptyEverything = async () => {
        if (appEntryCount === 0) {
            notify(t("trash.emptyNone"), true);
            return;
        }
        const { response } = await dialogUtils.warn({
            title: t("trash.emptyConfirmTitle"),
            message: t("trash.emptyConfirmMessage", { count: appEntryCount }),
            detail: t("trash.emptyConfirmDetail"),
            noOption: false,
            buttons: [t("actions.cancel", { ns: "common" }), t("trash.emptyTrash")],
            defaultId: 0,
            cancelId: 0,
        });
        if (!response) return;

        setBulkBusy("empty");
        setMessage("");
        setIsError(false);
        try {
            const result = await emptyTrash();
            notify(result.ok ? t("trash.emptyDone", { count: result.count }) : result.message, !result.ok);
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setBulkBusy("");
            await load();
        }
    };

    const openFolder = async () => {
        setBulkBusy("open");
        setMessage("");
        setIsError(false);
        try {
            await openTrashFolder();
        } catch (err) {
            notify(errorText(err), true);
        } finally {
            setBulkBusy("");
        }
    };

    return (
        <div className="trashPanelOverlay" role="dialog" aria-modal="true" aria-label={t("trash.title")}>
            <div className="trashPanel">
                <header className="trashPanelHead">
                    <div className="trashPanelHeadText">
                        <span className="trashPanelEyebrow">Recently deleted</span>
                        <h2>{t("trash.title")}</h2>
                        <p>{t("trash.desc")}</p>
                        <div className="trashPanelStats" aria-live="polite">
                            {loading ? (
                                <span className="trashStatChip">{t("trash.loading")}</span>
                            ) : (
                                <>
                                    <span className="trashStatChip">
                                        {t("trash.itemCount", { count: stats.count })}
                                    </span>
                                    <span className="trashStatChip">
                                        {t("trash.totalSize", { size: formatTrashBytes(stats.totalBytes) })}
                                    </span>
                                </>
                            )}
                        </div>
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
                    <div className="trashSearchWrap">
                        <input
                            type="search"
                            className="trashSearch"
                            value={query}
                            onChange={(event) => setQuery(event.currentTarget.value)}
                            placeholder={t("trash.searchPlaceholder")}
                            aria-label={t("trash.searchPlaceholder")}
                        />
                        {query ? (
                            <button
                                type="button"
                                className="trashSearchClear"
                                onClick={() => setQuery("")}
                                aria-label={t("trash.clearSearch")}
                            >
                                ×
                            </button>
                        ) : null}
                    </div>
                    <label className="trashRetention">
                        <span>{t("trash.retention")}</span>
                        <select
                            value={retentionDays}
                            onChange={(event) => changeDefaultRetention(Number(event.currentTarget.value))}
                        >
                            {TRASH_RETENTION_DAYS.map((days) => (
                                <option key={days} value={days}>
                                    {t("trash.daysOption", { count: days })}
                                </option>
                            ))}
                        </select>
                    </label>
                    <button type="button" disabled={bulkBusy !== ""} onClick={() => void refresh()}>
                        {bulkBusy === "refresh" ? t("trash.refreshing") : t("trash.refresh")}
                    </button>
                    <button type="button" disabled={bulkBusy !== ""} onClick={() => void openFolder()}>
                        {t("trash.openFolder")}
                    </button>
                </div>

                <div className="trashPanelToolbar is-actions">
                    <button
                        type="button"
                        className="is-primary"
                        disabled={actionsBusy || loading || entries.length === 0}
                        onClick={() => void restoreEverything()}
                    >
                        {bulkBusy === "restoreAll" ? t("trash.restoringAll") : t("trash.restoreAll")}
                    </button>
                    <button
                        type="button"
                        className="is-danger"
                        disabled={actionsBusy || loading || appEntryCount === 0}
                        onClick={() => void emptyEverything()}
                    >
                        {bulkBusy === "empty" ? t("trash.emptyingTrash") : t("trash.emptyTrash")}
                    </button>
                    <span className="trashRetentionHint">{t("trash.retentionHint")}</span>
                </div>

                {message ? (
                    <div className={`trashPanelMessage ${isError ? "is-error" : ""}`} aria-live="polite">
                        {message}
                    </div>
                ) : null}

                <div className="trashPanelList">
                    {loading ? (
                        <p className="trashPanelEmpty">{t("trash.loading")}</p>
                    ) : entries.length === 0 ? (
                        <p className="trashPanelEmpty">{t("trash.empty")}</p>
                    ) : visibleEntries.length === 0 ? (
                        <p className="trashPanelEmpty">{t("trash.noMatches", { query: query.trim() })}</p>
                    ) : (
                        visibleEntries.map((entry) => {
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
                                        {legacy ? null : (
                                            <select
                                                className="trashRowRetention"
                                                value={entry.retentionDays ?? retentionDays}
                                                disabled={busy || bulkBusy !== ""}
                                                aria-label={t("trash.itemRetention")}
                                                title={t("trash.itemRetention")}
                                                onChange={(event) =>
                                                    changeRetention(entry, Number(event.currentTarget.value))
                                                }
                                            >
                                                {TRASH_RETENTION_DAYS.map((days) => (
                                                    <option key={days} value={days}>
                                                        {t("trash.daysOption", { count: days })}
                                                    </option>
                                                ))}
                                            </select>
                                        )}
                                        <button
                                            type="button"
                                            disabled={busy || bulkBusy !== ""}
                                            onClick={() => void recover(entry)}
                                        >
                                            {t("trash.recover")}
                                        </button>
                                        {legacy ? (
                                            <button
                                                type="button"
                                                disabled={busy || bulkBusy !== ""}
                                                onClick={() => void forget(entry)}
                                            >
                                                {t("trash.forget")}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className="is-danger"
                                                disabled={busy || bulkBusy !== ""}
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
                    <span>
                        {query.trim()
                            ? t("trash.showing", {
                                  shown: visibleEntries.length,
                                  total: entries.length,
                              })
                            : t("trash.count", { count: stats.count })}
                    </span>
                    <button type="button" onClick={onClose}>
                        {t("trash.close")}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default TrashPanel;
