import { TRASH_RETENTION_DAYS, type TrashRetentionDays } from "@common/types/trash";
import { useAppContext } from "@renderer/App";
import { setAppSettings } from "@store/appSettings";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { setSettingsOpen } from "@store/ui";
import { openTrashFolder } from "@utils/trash";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./trashManager.scss";

/** Settings entry point for Recently Deleted, its retention period and trash folder. */
const TrashManager = () => {
    const { t } = useTranslation("settings");
    const dispatch = useAppDispatch();
    const { openTrash } = useAppContext();
    const retentionDays = useAppSelector((state) => state.appSettings.trashRetentionDays);
    const [count, setCount] = useState(0);
    const [message, setMessage] = useState("");

    const load = useCallback(async () => {
        const rows = await window.electron.invoke("trash:list", { limit: 500 });
        setCount(rows.length);
    }, []);

    useEffect(() => {
        void load();
        const onChange = () => void load();
        window.addEventListener("yokomura:trash-changed", onChange);
        return () => window.removeEventListener("yokomura:trash-changed", onChange);
    }, [load]);

    const openFolder = async () => {
        try {
            await openTrashFolder();
            setMessage("");
        } catch (err) {
            setMessage(err instanceof Error ? err.message : String(err));
        }
    };

    const openPanel = () => {
        dispatch(setSettingsOpen(false));
        openTrash();
    };

    return (
        <div className="settingItem2" id="settings-recentlyDeleted">
            <h3>{t("trash.title")}</h3>
            <div className="desc">{t("trash.desc")}</div>
            <div className="main row trashSettingsRow">
                <label className="trashSettingsField">
                    <span>{t("trash.retention")}</span>
                    <select
                        value={retentionDays}
                        onChange={(event) =>
                            dispatch(
                                setAppSettings({
                                    trashRetentionDays: Number(event.currentTarget.value) as TrashRetentionDays,
                                }),
                            )
                        }
                    >
                        {TRASH_RETENTION_DAYS.map((days) => (
                            <option key={days} value={days}>
                                {t("trash.daysOption", { count: days })}
                            </option>
                        ))}
                    </select>
                </label>
                <span className="trashSettingsHint">{t("trash.retentionHint")}</span>
            </div>
            <div className="main row">
                <button type="button" onClick={openPanel}>
                    {t("trash.openPanel", { count })}
                </button>
                <button type="button" onClick={() => void openFolder()}>
                    {t("trash.openFolder")}
                </button>
            </div>
            {message ? <div className="trashManagerMessage">{message}</div> : null}
        </div>
    );
};

export default TrashManager;
