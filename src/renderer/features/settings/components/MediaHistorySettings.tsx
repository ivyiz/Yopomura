import { clearAllWatchedPositions } from "@features/media/mediaLibrary";
import { clearRecentFolders, clearRecentVideos } from "@features/media/mediaRecents";
import { clearRecentDownloads } from "@features/media/recentDownloads";
import { dialogUtils } from "@utils/dialog";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Settings entry point for the Media panel history.
 * Clearing lives here so the Media panel itself stays free of destructive actions.
 */
const MediaHistorySettings = () => {
    const { t } = useTranslation("settings");
    const [message, setMessage] = useState("");

    const confirmClear = async (run: () => void) => {
        const { response } = await dialogUtils.warn({
            title: t("mediaHistory.confirmTitle"),
            message: t("mediaHistory.confirmMessage"),
            detail: "",
            noOption: false,
            buttons: ["Cancel", t("mediaHistory.clear")],
            defaultId: 0,
        });
        if (!response) return;
        run();
        setMessage(t("mediaHistory.cleared"));
    };

    return (
        <div className="settingItem2" id="settings-mediaHistory">
            <h3>{t("mediaHistory.title")}</h3>
            <div className="desc">{t("mediaHistory.desc")}</div>
            <div className="main row">
                <button
                    type="button"
                    title={t("mediaHistory.clearVideosDesc")}
                    onClick={() =>
                        void confirmClear(() => {
                            clearAllWatchedPositions();
                            clearRecentVideos();
                        })
                    }
                >
                    {t("mediaHistory.clearVideos")}
                </button>
                <button
                    type="button"
                    title={t("mediaHistory.clearFoldersDesc")}
                    onClick={() => void confirmClear(() => clearRecentFolders())}
                >
                    {t("mediaHistory.clearFolders")}
                </button>
                <button
                    type="button"
                    title={t("mediaHistory.clearDownloadsDesc")}
                    onClick={() => void confirmClear(() => clearRecentDownloads())}
                >
                    {t("mediaHistory.clearDownloads")}
                </button>
            </div>
            {message ? <div className="desc">{message}</div> : null}
        </div>
    );
};

export default MediaHistorySettings;
