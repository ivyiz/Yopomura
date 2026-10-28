import type { DownloaderJob } from "@common/types/downloader";
import { formatBytes } from "@features/media/mediaLibrary";
import { faFile, faFilm } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppContext } from "@renderer/App";
import { useCallback, useEffect, useRef, useState } from "react";
import "./downloadToast.scss";

type ToastData = {
    id: string;
    title: string;
    status: string;
    detail: string;
    progress: number;
    video: boolean;
    autoHide: boolean;
};

const isVideo = (value: string): boolean => /\.(mp4|webm)(\?|#|$)/i.test(value);

/** Browser-style download bubble for browser and Downloader jobs. */
const DownloadToast = () => {
    const { openDownloader } = useAppContext();
    const [toast, setToast] = useState<ToastData | null>(null);
    const timerRef = useRef<number | null>(null);
    const seenTerminalRef = useRef(new Set<string>());

    const show = useCallback((data: ToastData) => {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = null;
        setToast(data);
        if (data.autoHide) {
            timerRef.current = window.setTimeout(() => setToast(null), 5000);
        }
    }, []);

    useEffect(() => {
        const offBrowser = window.electron.on("browser:download", (download) => {
            const video = isVideo(download.savePath || download.filename);
            if (download.state === "progressing") {
                show({
                    id: download.id,
                    title: download.filename,
                    status: "Downloading",
                    detail:
                        download.total > 0
                            ? `${formatBytes(download.received)} of ${formatBytes(download.total)}`
                            : "Starting…",
                    progress: download.total > 0 ? Math.round((download.received / download.total) * 100) : 0,
                    video,
                    autoHide: false,
                });
                return;
            }
            const status =
                download.state === "completed"
                    ? "Done"
                    : download.state === "interrupted"
                      ? "Interrupted"
                      : "Cancelled";
            show({
                id: download.id,
                title: download.filename,
                status,
                detail: `${formatBytes(download.received)} · ${status}`,
                progress: 100,
                video,
                autoHide: true,
            });
        });

        const offDownloader = window.electron.on("downloader:state", (state) => {
            const jobs: DownloaderJob[] = state.jobs;
            const active =
                jobs.find((job) => job.id === state.activeId) ??
                jobs.find((job) => job.status === "resolving" || job.status === "downloading");
            if (active) {
                show({
                    id: active.id,
                    title: active.title || active.url,
                    status:
                        active.status === "resolving"
                            ? "Resolving"
                            : active.status === "packing"
                              ? "Packing"
                              : "Downloading",
                    detail:
                        active.total > 0
                            ? `${active.downloaded}/${active.total} images`
                            : active.message || "Starting…",
                    progress: Math.round(active.progress),
                    video: false,
                    autoHide: false,
                });
                return;
            }

            const latest = [...jobs]
                .reverse()
                .find(
                    (job) =>
                        (job.status === "done" || job.status === "error" || job.status === "cancelled") &&
                        !seenTerminalRef.current.has(`${job.id}:${job.status}`),
                );
            if (!latest) return;
            seenTerminalRef.current.add(`${latest.id}:${latest.status}`);
            const status =
                latest.status === "done" ? "Done" : latest.status === "cancelled" ? "Cancelled" : "Error";
            show({
                id: latest.id,
                title: latest.title || latest.url,
                status,
                detail:
                    latest.status === "done"
                        ? `${latest.total} images · Done`
                        : `${status}${latest.error ? ` · ${latest.error}` : ""}`,
                progress: 100,
                video: false,
                autoHide: true,
            });
        });

        return () => {
            offBrowser();
            offDownloader();
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        };
    }, [show]);

    if (!toast) return null;

    return (
        <button
            type="button"
            className="downloadToast"
            title={toast.title}
            onClick={() => {
                setToast(null);
                openDownloader();
            }}
        >
            <span className="downloadToastIcon" aria-hidden>
                <FontAwesomeIcon icon={toast.video ? faFilm : faFile} />
            </span>
            <span className="downloadToastBody">
                <span className="downloadToastTitle">{toast.title}</span>
                <span className="downloadToastMeta">
                    {toast.status === "Downloading" ? toast.detail : `${toast.detail}`}
                </span>
                {toast.progress > 0 && toast.progress < 100 ? (
                    <span className="downloadToastProgress" aria-hidden>
                        <span style={{ width: `${toast.progress}%` }} />
                    </span>
                ) : null}
            </span>
        </button>
    );
};

export default DownloadToast;
