import { useEffect } from "react";
import { addRecentDownload } from "./recentDownloads";

/**
 * Records videos downloaded directly from the integrated browser into the
 * Media "Recently Downloaded" playlist. Downloader jobs are intentionally
 * excluded; only completed browser downloads count.
 */
export const useBrowserDownloadRecorder = (): void => {
    useEffect(() => {
        const off = window.electron.on("browser:download", (download) => {
            if (download.state !== "completed") return;
            addRecentDownload(download.savePath);
        });
        return off;
    }, []);
};
