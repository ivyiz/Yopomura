import { getDefaultLocationPath } from "@common/library/folders";
import type { DownloaderJob, DownloaderState } from "@common/types/downloader";
import { faFolderOpen, faPause, faPlay, faTrash, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppSelector } from "@store/hooks";
import { promptSelectDir } from "@utils/file";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import "./downloaderPanel.scss";

type DownloaderPanelProps = {
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

const DownloaderPanel = ({ onClose, onOpenOutput }: DownloaderPanelProps) => {
    const { t } = useTranslation("home");
    const folders = useAppSelector((store) => store.mainSettings.library.folders);
    const defaultDir = getDefaultLocationPath(folders) || "";
    const [urls, setUrls] = useState("");
    const [outDir, setOutDir] = useState(defaultDir);
    const [keepFolder, setKeepFolder] = useState(false);
    const [state, setState] = useState<DownloaderState>({ ready: false, activeId: null, paused: false, jobs: [] });
    const [busy, setBusy] = useState(false);

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

    const add = async () => {
        if (busy) return;
        const list = urls
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => /^https?:\/\//i.test(line));
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
            setUrls("");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="downloaderOverlay" role="dialog" aria-label="Downloader">
            <div className="downloaderPanel">
                <div className="downloaderHead">
                    <div>
                        <h2>Downloader</h2>
                    </div>
                    <div className="downloaderHeadActions">
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
                        <button type="button" className="downloaderClose" onClick={onClose} title="Close">
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>
                </div>

                <div className="downloaderCompose">
                    <label>
                        <span>LINKS</span>
                        <textarea
                            value={urls}
                            onChange={(e) => setUrls(e.target.value)}
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
                            disabled={busy || !urls.trim() || !outDir.trim()}
                        >
                            Add to queue
                        </button>
                    </div>
                </div>

                <div className="downloaderQueueHead">
                    <span>QUEUE</span>
                    <span>{jobs.length} jobs</span>
                    <button type="button" onClick={() => void window.electron.invoke("downloader:clearFinished")}>
                        Clear finished
                    </button>
                </div>

                <div className="downloaderJobs">
                    {jobs.length === 0 ? (
                        <p className="downloaderEmpty">Chưa có job nào. Dán link và bấm Add to queue.</p>
                    ) : (
                        jobs.map((job) => (
                            <div className={`downloaderJob is-${job.status}`} key={job.id}>
                                <div className="downloaderJobTop">
                                    <strong>{job.title || job.url}</strong>
                                    <span className="downloaderStatus">{STATUS_LABEL[job.status]}</span>
                                </div>
                                <div className="downloaderUrl">{job.url}</div>
                                <div className="downloaderProgress">
                                    <span style={{ width: `${Math.max(0, Math.min(100, job.progress))}%` }} />
                                </div>
                                <div className="downloaderJobBottom">
                                    <span>
                                        {job.total > 0 ? `${job.downloaded}/${job.total} ảnh` : job.message || ""}
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
                <div className="downloaderFoot">
                    <span>{t("classic.location.title")} · ZIP tự động · Downloader sidecar</span>
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DownloaderPanel;
