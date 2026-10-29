import { getDefaultLocationPath } from "@common/library/folders";
import type {
    DownloaderJob,
    DownloaderPreview,
    DownloaderRecipeDraft,
    DownloaderRecipeSummary,
    DownloaderState,
} from "@common/types/downloader";
import { formatBytes } from "@features/media/mediaLibrary";
import {
    faClockRotateLeft,
    faFile,
    faFilm,
    faFolderOpen,
    faGlobe,
    faPause,
    faPlay,
    faTrash,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppSelector } from "@store/hooks";
import { dialogUtils } from "@utils/dialog";
import { promptSelectDir } from "@utils/file";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
    initialView?: "queue" | "history" | "sites";
    /** Changes on every open request so an already-mounted panel still switches views. */
    viewRequest?: number;
    /** Draft from the visual browser recipe builder. */
    recipeDraft?: DownloaderRecipeDraft | null;
    onRecipeDraftConsumed?: () => void;
    onClose: () => void;
    onOpenOutput: (path: string) => void;
};

const STATUS_LABEL: Record<DownloaderJob["status"], string> = {
    queued: "Queued",
    resolving: "Resolving",
    review: "Review Images",
    downloading: "Downloading",
    paused: "Paused",
    packing: "Packing ZIP",
    done: "Done",
    error: "Error",
    cancelled: "Cancelled",
};

/** Statuses that mean the worker still owes this job work. */
const PENDING_STATUSES: DownloaderJob["status"][] = [
    "queued",
    "resolving",
    "review",
    "downloading",
    "paused",
    "packing",
];

const SOURCE_LABEL: Record<DownloaderPreview["source"], string> = {
    recipe: "Recipe",
    extractor: "Site extractor",
    browser: "Browser resolver",
    unknown: "Unknown",
};

const DOWNLOADER_OUT_DIR_KEY = "yokomura-downloader-out-dir";

const readDownloaderOutDir = (fallback: string): string => {
    try {
        return window.localStorage.getItem(DOWNLOADER_OUT_DIR_KEY)?.trim() || fallback;
    } catch {
        return fallback;
    }
};

const rememberDownloaderOutDir = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    try {
        window.localStorage.setItem(DOWNLOADER_OUT_DIR_KEY, trimmed);
    } catch {
        // Storage can be unavailable; the folder still applies to this session.
    }
};

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
    recipeDraft = null,
    onRecipeDraftConsumed,
    onClose,
    onOpenOutput,
}: DownloaderPanelProps) => {
    const folders = useAppSelector((store) => store.mainSettings.library.folders);
    const defaultDir =
        getDefaultLocationPath(folders) || window.path.join(window.electron.app.getPath("userData"), "downloads");
    const [outDir, setOutDir] = useState(() => readDownloaderOutDir(defaultDir));
    const [keepFolder, setKeepFolder] = useState(false);
    const [state, setState] = useState<DownloaderState>({ ready: false, activeId: null, paused: false, jobs: [] });
    const [busy, setBusy] = useState(false);
    const [view, setView] = useState<"queue" | "history" | "sites">(initialView);
    const [history, setHistory] = useState<DownloadHistoryEntry[]>(readDownloadHistory);
    const [recipes, setRecipes] = useState<DownloaderRecipeSummary[]>([]);
    const [recipesBusy, setRecipesBusy] = useState(false);
    const [recipeMessage, setRecipeMessage] = useState("");
    const [previewUrl, setPreviewUrl] = useState("");
    const [preview, setPreview] = useState<DownloaderPreview | null>(null);
    const [previewBusy, setPreviewBusy] = useState(false);
    const [editor, setEditor] = useState<DownloaderRecipeDraft | null>(null);

    useEffect(() => {
        if (!recipeDraft) return;
        setEditor({ ...recipeDraft });
        setView("sites");
        onRecipeDraftConsumed?.();
    }, [recipeDraft, onRecipeDraftConsumed]);

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

    const refreshRecipes = useCallback(async () => {
        setRecipesBusy(true);
        try {
            setRecipes(await window.electron.invoke("downloader:listRecipes"));
        } finally {
            setRecipesBusy(false);
        }
    }, []);

    useEffect(() => {
        if (view === "sites") void refreshRecipes();
    }, [view, refreshRecipes]);

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
            rememberDownloaderOutDir(outDir);
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

    const importRecipe = async () => {
        const result = await window.electron.invoke("downloader:importRecipe");
        if (result.ok) {
            setRecipeMessage(`Imported ${result.recipe.name}`);
            await refreshRecipes();
        } else {
            setRecipeMessage(result.message);
        }
    };

    const updateEditor = (patch: Partial<DownloaderRecipeDraft>) => {
        setEditor((current) => (current ? { ...current, ...patch } : current));
    };

    const newRecipe = () => {
        setEditor({
            id: "new-site",
            name: "New Site",
            match: [],
            mode: "gallery",
            titleSelector: "h1",
            pageSelector: "img",
        });
        setPreviewUrl("");
        setPreview(null);
        setRecipeMessage("");
    };

    const saveEditor = async () => {
        if (!editor) return;
        const result = await window.electron.invoke("downloader:saveRecipe", editor);
        if (result.ok) {
            setRecipeMessage(`Saved ${result.recipe.name}`);
            setEditor(null);
            await refreshRecipes();
        } else {
            setRecipeMessage(result.message);
        }
    };

    const deleteRecipe = (recipe: DownloaderRecipeSummary) => {
        void dialogUtils
            .warn({
                title: "Remove site recipe?",
                message: `Remove ${recipe.name}? Downloaded files stay on disk.`,
                buttons: ["Cancel", "Remove"],
                defaultId: 0,
            })
            .then(async ({ response }) => {
                if (response !== 1) return;
                await window.electron.invoke("downloader:deleteRecipe", { id: recipe.id });
                setRecipeMessage(`Removed ${recipe.name}`);
                await refreshRecipes();
            });
    };

    const openRecipeFolder = () => {
        void window.electron.invoke("downloader:openRecipeFolder");
    };

    const runPreview = async (override?: string) => {
        const url = (override ?? previewUrl).trim();
        if (!url) return;
        setPreviewBusy(true);
        setPreview(null);
        try {
            setPreview(await window.electron.invoke("downloader:preview", { url }));
        } finally {
            setPreviewBusy(false);
        }
    };

    return (
        <div className="downloaderOverlay" role="dialog" aria-label="Downloader">
            <div className="downloaderPanel">
                <div className="downloaderHead">
                    <div>
                        <h2>
                            {view === "history"
                                ? "Download History"
                                : view === "sites"
                                  ? "Site Recipes"
                                  : "Downloader"}
                        </h2>
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
                            className={`downloaderSitesBtn${view === "sites" ? " is-active" : ""}`}
                            title={view === "sites" ? "Back to downloads" : "Site Recipes"}
                            aria-label={view === "sites" ? "Back to downloads" : "Site Recipes"}
                            aria-pressed={view === "sites"}
                            onClick={() => setView((current) => (current === "sites" ? "queue" : "sites"))}
                        >
                            <FontAwesomeIcon icon={faGlobe} />
                        </button>
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
                                            if (path) {
                                                setOutDir(path);
                                                rememberDownloaderOutDir(path);
                                            }
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
                                                    job.status === "review" ||
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
                ) : view === "history" ? (
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
                ) : (
                    <div className="downloaderSites">
                        <div className="downloaderSitesToolbar">
                            <button type="button" onClick={newRecipe}>
                                New Recipe
                            </button>
                            <button type="button" onClick={() => void importRecipe()}>
                                Import Recipe
                            </button>
                            <button type="button" onClick={openRecipeFolder}>
                                Open Folder
                            </button>
                            <button type="button" onClick={() => void refreshRecipes()} disabled={recipesBusy}>
                                {recipesBusy ? "Loading…" : "Refresh"}
                            </button>
                        </div>
                        {recipeMessage ? <p className="downloaderSitesMessage">{recipeMessage}</p> : null}
                        {editor ? (
                            <div className="downloaderRecipeEditor">
                                <div className="downloaderRecipeEditorHead">
                                    <strong>Recipe Editor</strong>
                                    <button type="button" onClick={() => setEditor(null)}>
                                        Cancel
                                    </button>
                                </div>
                                <div className="downloaderRecipeEditorGrid">
                                    <label>
                                        <span>Name</span>
                                        <input
                                            value={editor.name}
                                            onChange={(event) => updateEditor({ name: event.currentTarget.value })}
                                        />
                                    </label>
                                    <label>
                                        <span>ID</span>
                                        <input
                                            value={editor.id}
                                            onChange={(event) => updateEditor({ id: event.currentTarget.value })}
                                        />
                                    </label>
                                    <label className="is-wide">
                                        <span>Hosts (comma separated)</span>
                                        <input
                                            value={editor.match.join(", ")}
                                            onChange={(event) =>
                                                updateEditor({
                                                    match: event.currentTarget.value
                                                        .split(",")
                                                        .map((value) => value.trim())
                                                        .filter(Boolean),
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>Mode</span>
                                        <select
                                            value={editor.mode}
                                            onChange={(event) =>
                                                updateEditor({
                                                    mode: event.currentTarget
                                                        .value as DownloaderRecipeDraft["mode"],
                                                })
                                            }
                                        >
                                            <option value="gallery">Gallery</option>
                                            <option value="reader">Reader</option>
                                            <option value="series">Series</option>
                                        </select>
                                    </label>
                                    <label>
                                        <span>Title selector</span>
                                        <input
                                            value={editor.titleSelector || ""}
                                            onChange={(event) =>
                                                updateEditor({ titleSelector: event.currentTarget.value })
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>Chapter selector</span>
                                        <input
                                            value={editor.chapterSelector || ""}
                                            disabled={editor.mode !== "series"}
                                            onChange={(event) =>
                                                updateEditor({
                                                    chapterSelector: event.currentTarget.value,
                                                })
                                            }
                                        />
                                    </label>
                                    <label className="is-wide">
                                        <span>Page image selector</span>
                                        <input
                                            value={editor.pageSelector || ""}
                                            onChange={(event) =>
                                                updateEditor({ pageSelector: event.currentTarget.value })
                                            }
                                        />
                                    </label>
                                    <label>
                                        <span>Next page selector</span>
                                        <input
                                            value={editor.nextSelector || ""}
                                            onChange={(event) =>
                                                updateEditor({ nextSelector: event.currentTarget.value })
                                            }
                                        />
                                    </label>
                                    <label className="is-wide">
                                        <span>Test URL</span>
                                        <input
                                            value={editor.testUrl || ""}
                                            onChange={(event) =>
                                                updateEditor({ testUrl: event.currentTarget.value })
                                            }
                                        />
                                    </label>
                                    <label className="is-wide">
                                        <span>Advanced script (optional)</span>
                                        <textarea
                                            value={editor.script || ""}
                                            onChange={(event) =>
                                                updateEditor({ script: event.currentTarget.value })
                                            }
                                            placeholder={
                                                "async ({ url }) => ({\n  title: document.title,\n  chapters: [...document.querySelectorAll('a.chapter')].map(a => ({ href: a.href, name: a.textContent })),\n  images: [...document.querySelectorAll('.reader img')].map(img => img.src),\n  next: document.querySelector('a.next')?.href || ''\n})"
                                            }
                                            spellCheck={false}
                                            rows={5}
                                        />
                                    </label>
                                    <p className="downloaderRecipeEditorWarning">
                                        Scripts run inside the sandboxed page. Only use recipes you trust.
                                    </p>
                                </div>
                                <div className="downloaderRecipeEditorActions">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (editor.testUrl) setPreviewUrl(editor.testUrl);
                                            void runPreview(editor.testUrl);
                                        }}
                                        disabled={previewBusy || !editor.testUrl?.trim()}
                                    >
                                        {previewBusy ? "Previewing…" : "Preview"}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void saveEditor()}
                                        disabled={
                                            !editor.id.trim() ||
                                            editor.match.length === 0 ||
                                            (!editor.pageSelector?.trim() && !editor.script?.trim())
                                        }
                                    >
                                        Save Recipe
                                    </button>
                                </div>
                            </div>
                        ) : null}
                        <div className="downloaderRecipes">
                            {recipes.length === 0 ? (
                                <p className="downloaderEmpty">
                                    No site recipes. Import a JSON recipe or add files to the recipes folder.
                                </p>
                            ) : (
                                recipes.map((recipe) => (
                                    <div className="downloaderRecipeRow" key={recipe.id}>
                                        <div className="downloaderRecipeText">
                                            <strong>{recipe.name}</strong>
                                            <span>
                                                {recipe.hosts.join(", ")} · {recipe.mode}
                                            </span>
                                        </div>
                                        <button
                                            type="button"
                                            title="Remove recipe"
                                            onClick={() => deleteRecipe(recipe)}
                                        >
                                            <FontAwesomeIcon icon={faTrash} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                        <div className="downloaderPreviewBox">
                            <label>
                                <span>Test URL</span>
                                <input
                                    value={previewUrl}
                                    onChange={(event) => setPreviewUrl(event.currentTarget.value)}
                                    placeholder="https://example.com/series"
                                    spellCheck={false}
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => void runPreview()}
                                disabled={previewBusy || !previewUrl.trim()}
                            >
                                {previewBusy ? "Previewing…" : "Preview"}
                            </button>
                            {preview ? (
                                <div className="downloaderPreviewResult">
                                    <strong>{preview.title || "No title"}</strong>
                                    <span>
                                        {SOURCE_LABEL[preview.source]} · {preview.mode} · {preview.chapters}{" "}
                                        chapters · {preview.images} images
                                    </span>
                                    <p>{preview.message}</p>
                                    {preview.sample.slice(0, 3).map((url) => (
                                        <span className="downloaderPreviewUrl" key={url} title={url}>
                                            {url}
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DownloaderPanel;
