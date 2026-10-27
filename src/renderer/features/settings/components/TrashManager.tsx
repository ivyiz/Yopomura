import type { TrashEntry } from "@common/types/trash";
import { useAppDispatch } from "@store/hooks";
import dateUtils from "@utils/date";
import { openRecycleBin, restoreTrashEntry } from "@utils/trash";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./trashManager.scss";

/** Settings section listing files the app moved to the OS recycle bin. */
const TrashManager = () => {
    const { t } = useTranslation("settings");
    const dispatch = useAppDispatch();
    const [entries, setEntries] = useState<TrashEntry[]>([]);
    const [busyId, setBusyId] = useState("");
    const [message, setMessage] = useState("");

    const load = useCallback(async () => {
        const rows = await window.electron.invoke("trash:list", { limit: 100 });
        setEntries(rows);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const restore = async (entry: TrashEntry) => {
        setBusyId(entry.id);
        setMessage("");
        const result = await restoreTrashEntry(dispatch, entry);
        setBusyId("");
        if (result.ok) {
            setMessage(t("trash.restored"));
            await load();
        } else {
            setMessage(result.message || t("trash.restoreFailed"));
        }
    };

    return (
        <div className="settingItem2" id="settings-recentlyDeleted">
            <h3>{t("trash.title")}</h3>
            <div className="desc">{t("trash.desc")}</div>
            <div className="main row">
                <button type="button" onClick={() => void openRecycleBin()}>
                    {t("trash.openBin")}
                </button>
                <button type="button" onClick={() => void load()}>
                    {t("trash.refresh")}
                </button>
            </div>
            {message ? <div className="trashManagerMessage">{message}</div> : null}
            <div className="trashManagerList">
                {entries.length === 0 ? (
                    <p className="trashManagerEmpty">{t("trash.empty")}</p>
                ) : (
                    entries.map((entry) => (
                        <div className={`trashManagerRow is-${entry.status}`} key={entry.id}>
                            <div className="trashManagerInfo">
                                <strong title={entry.originalPath}>{entry.name}</strong>
                                <span>
                                    {entry.status === "restored"
                                        ? t("trash.restored")
                                        : entry.status === "missing"
                                          ? t("trash.missing")
                                          : t("trash.inBin")}
                                    {" · "}
                                    {dateUtils.format(entry.deletedAt, {
                                        format: dateUtils.presets.dateTime,
                                    })}
                                </span>
                            </div>
                            <div className="trashManagerActions">
                                {entry.status === "trashed" ? (
                                    <button
                                        type="button"
                                        disabled={busyId === entry.id}
                                        onClick={() => void restore(entry)}
                                    >
                                        {t("trash.restore")}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() =>
                                        void window.electron
                                            .invoke("trash:removeEntry", {
                                                id: entry.id,
                                            })
                                            .then(load)
                                    }
                                >
                                    {t("trash.forget")}
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

export default TrashManager;
