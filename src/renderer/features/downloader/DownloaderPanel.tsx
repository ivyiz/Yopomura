import { getDefaultLocationPath } from "@common/library/folders";
import type { DownloaderJob, DownloaderState } from "@common/types/downloader";
import { formatBytes } from "@features/media/mediaLibrary";
import {
    faClockRotateLeft,
    faFile,
    faFilm,
    faFolderOpen,
    faPause,
    faPlay,
    faTrash,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppSelector } from "@store/hooks";
import { dialogUtils } from "@utils/dialog";
import { promptSelectDir } from "@utils/file";
import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
    clearDownloadHistory,
    DOWNLOAD_HISTORY_EVENT,
    type DownloadHistoryEntry,
    type DownloadHistoryStatus,
    readDownloadHistory,
    removeDownloadHistory,
} from "./downloadHistory";
import "./downloaderPanel.scss";

type DownloaderPanelProps = {
    /** Shared draft; browser sends append to it and it survives closing the pane. */
    draft: string;
    onDraftChange: (draft: string) => void;
    /** Queue on normal open, history when opened from the browser Downloads bubble. */
    initialView?: "queue" | "history";
    /** Changes on every open request so an already-mounted panel still switches views. */
    viewRequest?: number;
    onClose: () => void;
    onOpenOutput: (path: string) => void;
};

const STATUS_LABEL: Record<DownloaderJob["status"], string> = {
    queued: "Queued",
    resolving: "Resolving",
    downloading: "Downloading",
    paused: "Paused",
    packing: "Packing ZIP",
    done: "Done",
    error: "Error",
    cancelled: "Cancelled",
};

/** Statuses that mean the worker still owes this job work. */
const PENDING_STATUSES: DownloaderJob["status"][] = ["queued", "resolving", "downloading", "paused", "packing"];

const HISTORY_STATUS_LABEL: Record<DownloadHistoryStatus, string> = {
    done: "Done",
    error: "Error",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
};

const historyHost = (url: string): string => {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
};

const isVideoHistory = (entry: DownloadHistoryEntry): boolean =>
    /\.(mp4|webm)$/i.test(entry.path) || /\.(mp4|webm)$/i.test(entry.title);

const DownloaderPanel = ({
    draft,
    onDraftChange,
    initialView = "queue",
    viewRequest = 0,
    onClose,
    onOpenOutput,
}: DownloaderPanelProps) => {
    const folders = useAppSelector((store) => store.mainSettings.library.folders);
    const defaultDir =
        getDefaultLocationPath(folders) || window.path.join(window.electron.app.getPath("userData"), "downloads");
    const [outDir, setOutDir] = useState(defaultDir);
    const [keepFolder, setKeepFolder] = useState(false);
    const [state, setState] = useState<DownloaderState>({ ready: false, activeId: null, paused: false, jobs: [] });
    const [busy, setBusy] = useState(false);
    const [view, setView] = useState<"queue" | "history">(initialView);
    const [history, setHistory] = useState<DownloadHistoryEntry[]>(readDownloadHistory);

    useEffect(() => {
        // Re-apply when the same view is requested again after a manual toggle.
        void viewRequest;
        setView(initialView);
    }, [initialView, viewRequest]);

    useEffect(() => {
        const sync = () => setHistory(readDownloadHistory());
        window.addEventListener(DOWNLOAD_HISTORY_EVENT, sync);
        return () => window.removeEventListener(DOWNLOAD_HISTORY_EVENT, sync);
    }, []);

    useEffect(() => {
        if (view === "history") setHistory(readDownloadHistory());
    }, [view]);

    /* The downloader is a layout-sharing right pane, not a modal overlay. */
    useLayoutEffect(() => {
        document.body.classList.add("downloaderSideOpen");
        return () => document.body.classList.remove("downloaderSideOpen");
    }, []);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [onClose]);

    useEffect(() => {
        let cancelled = false;
        void window.electron.invoke("downloader:getState").then((next) => {
            if (!cancelled) setState(next);
        });
        const off = window.electron.on("downloader:state", (next) => {
            if (!cancelled) setState(next);
        });
        return () => {
            cancelled = true;
            off();
        };
    }, []);

    const jobs = useMemo(() => [...state.jobs].reverse(), [state.jobs]);
    const canTogglePause =
        state.paused || state.activeId !== null || jobs.some((job) => PENDING_STATUSES.includes(job.status));

    const togglePause = () => {
        if (state.paused) {
            void window.electron.invoke("downloader:resume");
        } else {
            void window.electron.invoke("downloader:pause");
        }
    };

    const draftLines = useMemo(
        () => [
            ...new Set(
                draft
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter((line) => /^https?:\/\//i.test(line)),
            ),
        ],
        [draft],
    );

    const add = async () => {
        if (busy) return;
        const list = draftLines;
        if (list.length === 0 || !outDir.trim()) return;
        setBusy(true);
        try {
            for (const url of list) {
                await window.electron.invoke("downloader:add", {
                    url,
                    outDir: outDir.trim(),
                    keepFolder,
                });
            }
            onDraftChange("");
        } finally {
            setBusy(false);
        }
    };

    const clearHistory = () => {
        void dialogUtils
            .warn({
                title: "Clear Download History?",
                message: "This removes the history list only. Downloaded files stay on disk.",
                buttons: ["Cancel", "Clear History"],
                defaultId: 0,
            })
            .then(({ response }) => {
                if (response === 1) {
                    clearDownloadHistory();
                    setHistory([]);
                }
            });
    };

    const removeHistoryEntry = (entry: DownloadHistoryEntry) => {
        setHistory(removeDownloadHistory(entry.id, entry.source));
    };

    return (
        <div className="downloaderOverlay" role="dialog" aria-label="Downloader">
            <div className="downloaderPanel">
                <div className="downloaderHead">
                    <div>
                        <h2>{view === "history" ? "Download History" : "Downloader"}</h2>
                    </div>
                    <div className="downloaderHeadActions">
                        {view === "queue" ? (
                            <button
                                type="button"
                                className="downloaderPause"
                                onClick={togglePause}
                                disabled={!canTogglePause}
                                title={state.paused ? "Resume downloads" : "Pause downloads"}
                            >
                                <FontAwesomeIcon icon={state.paused ? faPlay : faPause} />
                                <span>{state.paused ? "Resume" : "Pause"}</span>
                            </button>
                        ) : null}
                        <button
                            type="button"
                            className={`downloaderHistoryBtn${view === "history" ? " is-active" : ""}`}
                            title={view === "history" ? "Back to Downloads" : "Download History"}
                            aria-label={view === "history" ? "Back to Downloads" : "Download History"}
                            aria-pressed={view === "history"}
                            onClick={() => setView((current) => (current === "history" ? "queue" : "history"))}
                        >
                            <FontAwesomeIcon icon={faClockRotateLeft} />
                        </button>
                        <button type="button" className="downloaderClose" onClick={onClose} title="Close">
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>
                </div>

                {view === "queue" ? (
                    <>
                        <div className="downloaderCompose">
                            <label>
                                <span>Links</span>
                                <textarea
                                    value={draft}
                                    onChange={(e) => onDraftChange(e.target.value)}
                                    placeholder={
                                        "Paste image, media or archive URLs\nhttps://example.com/gallery\nhttps://example.com/file.zip"
                                    }
                                    spellCheck={false}
                                />
                            </label>
                            <div className="downloaderRow">
                                <input
                                    value={outDir}
                                    onChange={(e) => setOutDir(e.target.value)}
                                    placeholder="Output folder"
                                />
                                <button
                                    type="button"
                                    onClick={() =>
                                        promptSelectDir((selected) => {
                                            const path = Array.isArray(selected) ? selected[0] : selected;
                                            if (path) setOutDir(path);
                                        })
                                    }
                                >
                                    Choose
                                </button>
                                <label className="downloaderCheck">
                                    <input
                                        type="checkbox"
                                        checked={keepFolder}
                                        onChange={(e) => setKeepFolder(e.currentTarget.checked)}
                                    />
                                    Keep image folder
                                </label>
                                <button
                                    type="button"
                                    className="downloaderAdd"
                                    onClick={() => void add()}
                                    disabled={busy || draftLines.length === 0 || !outDir.trim()}
                                >
                                    {draftLines.length > 1 ? `Add ${draftLines.length} to Queue` : "Add to Queue"}
                                </button>
                            </div>
                        </div>

                        <div className="downloaderQueueHead">
                            <span>Queue</span>
                            <span>{jobs.length} jobs</span>
                            <button
                                type="button"
                                onClick={() => void window.electron.invoke("downloader:clearFinished")}
                            >
                                Clear finished
                            </button>
                        </div>

                        <div className="downloaderJobs">
                            {jobs.length === 0 ? (
                                <p className="downloaderEmpty">Chưa có job nào. Dán link và bấm Add to Queue.</p>
                            ) : (
                                jobs.map((job) => (
                                    <div className={`downloaderJob is-${job.status}`} key={job.id}>
                                        <div className="downloaderJobTop">
                                            <strong>{job.title || job.url}</strong>
                                            <span className="downloaderStatus">{STATUS_LABEL[job.status]}</span>
                                        </div>
                                        <div className="downloaderUrl">{job.url}</div>
                                        <div className="downloaderProgress">
                                            <span
                                                style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }}
                                            />
                                        </div>
                                        <div className="downloaderJobBottom">
                                            <span>
                                                {job.total > 0
                                                    ? `${job.downloaded}/${job.total} ảnh`
                                                    : job.message || ""}
                                            </span>
                                            <span>{Math.round(job.progress)}%</span>
                                            <span className="downloaderJobActions">
                                                {job.outputPath && job.status === "done" ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            title="Open output"
                                                            onClick={() => onOpenOutput(job.outputPath)}
                                                        >
                                                            Open
                                                        </button>
                                                        <button
                                                            type="button"
                                                            title="Show in File Explorer"
                                                            onClick={() =>
                                                                window.electron.showItemInFolder(job.outputPath)
                                                            }
                                                        >
                                                            <FontAwesomeIcon icon={faFolderOpen} />
                                                        </button>
                                                    </>
                                                ) : null}
                                                {(job.status === "queued" ||
                                                    job.status === "resolving" ||
                                                    job.status === "downloading" ||
                                                    job.status === "paused" ||
                                                    job.status === "packing") && (
                                                    <button
                                                        type="button"
                                                        title="Cancel"
                                                        onClick={() =>
                                                            void window.electron.invoke("downloader:cancel", {
                                                                id: job.id,
                                                            })
                                                        }
                                                    >
                                                        <FontAwesomeIcon icon={faXmark} />
                                                    </button>
                                                )}
                                                {job.status === "done" ||
                                                job.status === "error" ||
                                                job.status === "cancelled" ? (
                                                    <button
                                                        type="button"
                                                        title="Remove from list"
                                                        onClick={() =>
                                                            void window.electron.invoke("downloader:remove", {
                                                                id: job.id,
                                                            })
                                                        }
                                                    >
                                                        <FontAwesomeIcon icon={faTrash} />
                                                    </button>
                                                ) : null}
                                            </span>
                                        </div>
                                        {job.error ? <div className="downloaderError">{job.error}</div> : null}
                                    </div>
                                ))
                            )}
                        </div>
                    </>
                ) : (
                    <div className="downloaderHistory">
                        <div className="downloaderHistoryHead">
                            <span>Download History</span>
                            <span>{history.length}</span>
                            <button type="button" onClick={clearHistory} disabled={history.length === 0}>
                                Clear History
                            </button>
                        </div>
                        {history.length === 0 ? (
                            <p className="downloaderEmpty">No Downloads Yet.</p>
                        ) : (
                            <div className="downloaderHistoryList">
                                {history.map((entry) => (
                                    <div className="downloaderHistoryRow" key={`${entry.source}:${entry.id}`}>
                                        <span className="downloaderHistoryIcon">
                                            <FontAwesomeIcon icon={isVideoHistory(entry) ? faFilm : faFile} />
                                        </span>
                                        <div className="downloaderHistoryBody">
                                            <strong title={entry.title}>{entry.title}</strong>
                                            <span className="downloaderHistoryMeta">
                                                {formatBytes(entry.bytes)} · {HISTORY_STATUS_LABEL[entry.status]} ·{" "}
                                                {new Date(entry.finishedAt).toLocaleDateString()}
                                            </span>
                                            <span className="downloaderHistoryUrl" title={entry.url}>
                                                {historyHost(entry.url)}
                                            </span>
                                        </div>
                                        <span className="downloaderHistoryActions">
                                            {entry.path ? (
                                                <button
                                                    type="button"
                                                    title="Show in File Explorer"
                                                    onClick={() => window.electron.showItemInFolder(entry.path)}
                                                >
                                                    <FontAwesomeIcon icon={faFolderOpen} />
                                                </button>
                                            ) : null}
                                            {entry.path ? (
                                                <button
                                                    type="button"
                                                    title="Open"
                                                    onClick={() => onOpenOutput(entry.path)}
                                                >
                                                    Open
                                                </button>
                                            ) : null}
                                            <button
                                                type="button"
                                                title="Remove from History"
                                                onClick={() => removeHistoryEntry(entry)}
                                            >
                                                <FontAwesomeIcon icon={faTrash} />
                                            </button>
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default DownloaderPanel;
