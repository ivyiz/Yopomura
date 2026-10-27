import { getDefaultLocationPath } from "@common/library/folders";
import {
    faArrowsRotate,
    faClockRotateLeft,
    faFilm,
    faFolderOpen,
    faMagnifyingGlass,
    faPlay,
    faRepeat,
    faTriangleExclamation,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppSelector } from "@store/hooks";
import { promptSelectDir } from "@utils/file";
import { absolutePathToFileUrl } from "@utils/libraryCover";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import MediaPlayerControls from "./MediaPlayerControls";
import {
    continueWatchingVideos,
    DEFAULT_SCAN_MAX_DEPTH,
    END_CLEAR_THRESHOLD_SECONDS,
    filterAndSortVideos,
    formatBytes,
    formatTime,
    normalizeVideoPath,
    readWatchedPosition,
    readWatchedPositions,
    removeWatchedPosition,
    scanVideoEntries,
    type VideoEntry,
    type VideoScanError,
    type VideoScanIo,
    type VideoSortMode,
    type WatchedPosition,
    writeWatchedPosition,
} from "./mediaLibrary";
import "./mediaPanel.scss";

export type MediaPanelProps = {
    onClose: () => void;
};

const MEDIA_VOLUME_KEY = "yokomura-media-volume";
const THEATER_KEY = "yokomura-media-theater";
const CUSTOM_ROOT_KEY = "yokomura-media-folder";
const POSITION_SAVE_DELAY_MS = 1000;
const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;
const MAX_CONTINUE_ITEMS = 6;

type ScanState = "scanning" | "done";
type PlayerStatus = "loading" | "ready" | "error";

const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
});

/** `Mar 4, 2026`, or a neutral label for unknown mtimes. */
const formatMediaDate = (timestampMs: number): string =>
    Number.isFinite(timestampMs) && timestampMs > 0 ? dateFormatter.format(new Date(timestampMs)) : "Unknown date";

/** Supported-container badge (`MP4`, `WEBM`); falls back to `VIDEO`. */
const extensionLabel = (path: string): string => {
    const extension = window.path.extname(path).replace(/^\./, "").toUpperCase();
    return extension || "VIDEO";
};

/** Parent folder name used in compact list rows. */
const folderLabel = (path: string): string => {
    const parent = window.path.dirname(path);
    return window.path.basename(parent) || parent || "Library";
};

/** Keyboard shortcuts ignore typing targets so shortcuts never steal text input. */
const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
    );
};

const clamp01 = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
};

const supportsPictureInPicture = (): boolean => {
    if (typeof document === "undefined" || !("pictureInPictureEnabled" in document)) return false;
    return Boolean(document.pictureInPictureEnabled);
};

/**
 * Full-window local video library: a large 16:9 stage with custom controls plus an
 * "Up next" sidebar built from the configured library folders.
 *
 * Rendering is owned by the caller (`onClose` only); nothing here is wired into the app shell.
 */
const MediaPanel = ({ onClose }: MediaPanelProps) => {
    const folders = useAppSelector((state) => state.mainSettings.library.folders);
    const [customRoot, setCustomRoot] = useState(() => {
        try {
            return window.localStorage.getItem(CUSTOM_ROOT_KEY)?.trim() ?? "";
        } catch {
            return "";
        }
    });

    /* A chosen media folder replaces the library roots; otherwise use them. */
    const roots = useMemo(() => {
        const result: string[] = [];
        const seen = new Set<string>();
        const add = (raw: string) => {
            const candidate = raw.trim();
            if (!candidate) return;
            const key = normalizeVideoPath(candidate);
            if (!key || seen.has(key)) return;
            seen.add(key);
            result.push(candidate);
        };
        if (customRoot) {
            add(customRoot);
            return result;
        }
        add(getDefaultLocationPath(folders));
        for (const folder of folders) add(folder.path);
        return result;
    }, [customRoot, folders]);

    /* Preload-backed reader; depth and error handling live in the pure scan helper. */
    const scanIo = useMemo<VideoScanIo>(
        () => ({
            readdir: async (directory) => {
                const names = await window.fs.readdir(directory);
                return Array.isArray(names) ? (names as string[]) : [];
            },
            stat: async (target) => {
                const stats = await window.fs.stat(target);
                return {
                    isDirectory: typeof stats.isDir === "boolean" ? stats.isDir : false,
                    sizeBytes: Number(stats.size) || 0,
                    modifiedMs: Number(stats.mtimeMs) || 0,
                };
            },
            join: (directory, name) => window.path.join(directory, name),
        }),
        [],
    );

    const panelRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const pathRef = useRef<string | null>(null);
    const autoplayRef = useRef(false);
    const mountedRef = useRef(true);
    const saveTimerRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);
    const lastDurationRef = useRef(0);

    const [entries, setEntries] = useState<VideoEntry[]>([]);
    const [scanErrors, setScanErrors] = useState<VideoScanError[]>([]);
    const [scanState, setScanState] = useState<ScanState>("scanning");
    const [refreshToken, setRefreshToken] = useState(0);
    const [query, setQuery] = useState("");
    const [sort, setSort] = useState<VideoSortMode>("newest");
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [watched, setWatched] = useState<WatchedPosition[]>(() => readWatchedPositions(window.localStorage));

    const [status, setStatus] = useState<PlayerStatus>("loading");
    const [errorMessage, setErrorMessage] = useState("");
    const [playing, setPlaying] = useState(false);
    const [buffering, setBuffering] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedTime, setBufferedTime] = useState(0);
    const [volume, setVolume] = useState(() => {
        try {
            const stored = Number.parseFloat(window.localStorage.getItem(MEDIA_VOLUME_KEY) ?? "");
            return Number.isFinite(stored) ? clamp01(stored) : 1;
        } catch {
            return 1;
        }
    });
    const [muted, setMuted] = useState(false);
    const [rate, setRate] = useState(1);
    const [autoplayNext, setAutoplayNext] = useState(true);
    const [theater, setTheater] = useState(() => {
        try {
            return window.localStorage.getItem(THEATER_KEY) === "1";
        } catch {
            return false;
        }
    });
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
    const [pipActive, setPipActive] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);

    const pipSupported = useMemo(() => supportsPictureInPicture(), []);
    const visible = useMemo(() => filterAndSortVideos(entries, { query, sort }), [entries, query, sort]);

    const selected = useMemo(() => {
        if (!selectedPath) return null;
        const key = normalizeVideoPath(selectedPath);
        return entries.find((entry) => normalizeVideoPath(entry.path) === key) ?? null;
    }, [entries, selectedPath]);

    const watchedByPath = useMemo(() => {
        const map = new Map<string, WatchedPosition>();
        for (const position of watched) {
            const key = normalizeVideoPath(position.path);
            if (key && !map.has(key)) map.set(key, position);
        }
        return map;
    }, [watched]);

    const continueItems = useMemo(
        () => continueWatchingVideos(entries, watched, MAX_CONTINUE_ITEMS),
        [entries, watched],
    );

    const refreshWatched = useCallback(() => {
        if (!mountedRef.current) return;
        setWatched(readWatchedPositions(window.localStorage));
    }, []);

    /* Scan on mount, on refresh, and whenever the configured roots change. */
    useEffect(() => {
        if (roots.length === 0) {
            setEntries([]);
            setScanErrors([]);
            setScanState("done");
            setWatched(readWatchedPositions(window.localStorage));
            return;
        }

        let cancelled = false;
        setScanState("scanning");

        /* The token itself is unused; referencing it keeps the rescan dependency explicit. */
        void refreshToken;

        void scanVideoEntries(scanIo, roots, { maxDepth: DEFAULT_SCAN_MAX_DEPTH })
            .then((result) => {
                if (cancelled) return;
                setEntries(result.entries);
                setScanErrors(result.errors);
                setScanState("done");
                setWatched(readWatchedPositions(window.localStorage));
            })
            .catch((error: unknown) => {
                if (cancelled) return;
                setEntries([]);
                setScanErrors([
                    {
                        path: roots[0] ?? "",
                        message: error instanceof Error ? error.message : String(error),
                    },
                ]);
                setScanState("done");
            });

        return () => {
            cancelled = true;
        };
    }, [refreshToken, roots, scanIo]);

    /* Keep the active file valid after rescans; first load selects the newest video. */
    useEffect(() => {
        if (entries.length === 0) {
            setSelectedPath(null);
            return;
        }
        if (selectedPath) {
            const key = normalizeVideoPath(selectedPath);
            if (entries.some((entry) => normalizeVideoPath(entry.path) === key)) return;
        }
        const newest = filterAndSortVideos(entries, { sort: "newest" })[0];
        setSelectedPath(newest?.path ?? null);
    }, [entries, selectedPath]);

    /* Path and transport state must be current before a new <video> can fire metadata. */
    useLayoutEffect(() => {
        pathRef.current = selectedPath;
        setCurrentTime(0);
        setDuration(0);
        setBufferedTime(0);
        setStatus("loading");
        setErrorMessage("");
        setBuffering(false);
        setPipActive(false);
        setSpeedMenuOpen(false);
    }, [selectedPath]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !selectedPath) return;
        video.volume = volume;
        video.muted = muted;
        video.playbackRate = rate;
    }, [muted, rate, selectedPath, volume]);

    useEffect(() => {
        try {
            window.localStorage.setItem(MEDIA_VOLUME_KEY, volume.toFixed(2));
        } catch {
            // volume persistence is optional
        }
    }, [volume]);

    useEffect(() => {
        try {
            window.localStorage.setItem(THEATER_KEY, theater ? "1" : "0");
        } catch {
            // layout preference is optional
        }
    }, [theater]);

    /* Focus the overlay, track fullscreen, and always flush/pause on unmount. */
    useEffect(() => {
        mountedRef.current = true;
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panelRef.current?.focus({ preventScroll: true });

        const handleFullscreenChange = () => {
            setIsFullscreen(Boolean(stageRef.current) && document.fullscreenElement === stageRef.current);
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            mountedRef.current = false;
            document.removeEventListener("fullscreenchange", handleFullscreenChange);

            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }

            const path = pathRef.current;
            if (path) {
                writeWatchedPosition(window.localStorage, path, lastTimeRef.current, lastDurationRef.current);
            }

            videoRef.current?.pause();
            previous?.focus({ preventScroll: true });
        };
    }, []);

    /* Picture-in-picture state follows the element (including user-initiated exits). */
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !selectedPath) return;
        const enter = () => setPipActive(true);
        const leave = () => setPipActive(false);
        video.addEventListener("enterpictureinpicture", enter);
        video.addEventListener("leavepictureinpicture", leave);
        return () => {
            video.removeEventListener("enterpictureinpicture", enter);
            video.removeEventListener("leavepictureinpicture", leave);
        };
    }, [selectedPath]);

    const flushPosition = useCallback(() => {
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const path = pathRef.current;
        if (!path) return;
        writeWatchedPosition(window.localStorage, path, lastTimeRef.current, lastDurationRef.current);
    }, []);

    const togglePlay = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused) {
            void video.play().catch(() => undefined);
        } else {
            video.pause();
        }
    }, []);

    const seekTo = useCallback((seconds: number) => {
        const video = videoRef.current;
        if (!video || !Number.isFinite(seconds)) return;
        const mediaDuration = Number.isFinite(video.duration) ? video.duration : 0;
        const upper = mediaDuration > 0 ? Math.max(0, mediaDuration - 0.05) : Math.max(0, seconds);
        const target = Math.min(Math.max(0, seconds), upper);
        video.currentTime = target;
        setCurrentTime(target);
    }, []);

    const seekBy = useCallback(
        (deltaSeconds: number) => {
            const video = videoRef.current;
            if (!video) return;
            seekTo(video.currentTime + deltaSeconds);
        },
        [seekTo],
    );

    const changeVolume = useCallback((nextVolume: number) => {
        const next = clamp01(nextVolume);
        setVolume(next);
        if (next > 0) setMuted(false);
    }, []);

    const adjustVolume = useCallback((delta: number) => {
        setVolume((previous) => {
            const next = Math.min(1, Math.max(0, Math.round((previous + delta) * 100) / 100));
            return next;
        });
        setMuted(false);
    }, []);

    const toggleMute = useCallback(() => setMuted((previous) => !previous), []);

    const toggleFullscreen = useCallback(() => {
        const stage = stageRef.current;
        if (!stage) return;
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => undefined);
            return;
        }
        void stage.requestFullscreen().catch(() => undefined);
    }, []);

    const togglePictureInPicture = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (document.pictureInPictureElement) {
            void document.exitPictureInPicture().catch(() => undefined);
            return;
        }
        void video.requestPictureInPicture().catch(() => undefined);
    }, []);

    const selectVideo = useCallback(
        (path: string) => {
            if (!path) return;
            if (pathRef.current && normalizeVideoPath(path) === normalizeVideoPath(pathRef.current)) {
                const video = videoRef.current;
                if (video?.paused) void video.play().catch(() => undefined);
                return;
            }
            flushPosition();
            autoplayRef.current = true;
            setSelectedPath(path);
            refreshWatched();
        },
        [flushPosition, refreshWatched],
    );

    const navigateVideo = useCallback(
        (delta: 1 | -1) => {
            if (visible.length === 0) return;
            const currentKey = normalizeVideoPath(pathRef.current ?? "");
            let index = visible.findIndex((item) => normalizeVideoPath(item.path) === currentKey);
            if (index < 0) index = delta > 0 ? -1 : 0;
            const nextIndex = (index + delta + visible.length) % visible.length;
            const target = visible[nextIndex];
            if (target) selectVideo(target.path);
        },
        [selectVideo, visible],
    );

    const goNext = useCallback(() => navigateVideo(1), [navigateVideo]);
    const goPrev = useCallback(() => navigateVideo(-1), [navigateVideo]);

    const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        video.volume = volume;
        video.muted = muted;
        video.playbackRate = rate;

        const path = pathRef.current;
        if (path) {
            const saved = readWatchedPosition(window.localStorage, path);
            const mediaDuration = video.duration;
            const knownDuration = Number.isFinite(mediaDuration) && mediaDuration > 0;

            if (saved) {
                if (knownDuration && mediaDuration - saved.time <= END_CLEAR_THRESHOLD_SECONDS) {
                    removeWatchedPosition(window.localStorage, path);
                    refreshWatched();
                } else if (saved.time > 1) {
                    try {
                        video.currentTime = knownDuration
                            ? Math.min(saved.time, Math.max(0, mediaDuration - 0.1))
                            : saved.time;
                    } catch {
                        // seeking can fail before the media is seekable; the position stays saved
                    }
                }
            }
        }

        lastTimeRef.current = video.currentTime;
        lastDurationRef.current = video.duration;
        setCurrentTime(video.currentTime);
        setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
    };

    const handleCanPlay = (event: SyntheticEvent<HTMLVideoElement>) => {
        setStatus("ready");
        setBuffering(false);
        if (autoplayRef.current) {
            autoplayRef.current = false;
            void event.currentTarget.play().catch(() => undefined);
        }
    };

    const handlePlaying = () => {
        setStatus("ready");
        setBuffering(false);
        setPlaying(true);
    };

    const handlePause = (event: SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        lastTimeRef.current = video.currentTime;
        lastDurationRef.current = video.duration;

        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }

        const path = pathRef.current;
        if (path) {
            writeWatchedPosition(window.localStorage, path, video.currentTime, video.duration);
        }

        if (!mountedRef.current) return;
        setPlaying(false);
        refreshWatched();
    };

    const handleWaiting = () => setBuffering(true);

    const handleProgress = (event: SyntheticEvent<HTMLVideoElement>) => {
        const ranges = event.currentTarget.buffered;
        if (ranges.length === 0) {
            setBufferedTime(0);
            return;
        }
        setBufferedTime(ranges.end(ranges.length - 1));
    };

    const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        const time = video.currentTime;
        const mediaDuration = video.duration;
        lastTimeRef.current = time;
        lastDurationRef.current = mediaDuration;
        setCurrentTime(time);
        if (Number.isFinite(mediaDuration) && mediaDuration > 0) setDuration(mediaDuration);

        /* Near the end the resume entry is meaningless; drop it immediately. */
        if (
            Number.isFinite(mediaDuration) &&
            mediaDuration > 0 &&
            mediaDuration - time <= END_CLEAR_THRESHOLD_SECONDS
        ) {
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            const path = pathRef.current;
            if (path) removeWatchedPosition(window.localStorage, path);
            return;
        }

        /* Trailing one-second throttle: timeupdate fires several times per second. */
        if (saveTimerRef.current === null) {
            saveTimerRef.current = window.setTimeout(() => {
                saveTimerRef.current = null;
                const path = pathRef.current;
                if (!path) return;
                writeWatchedPosition(window.localStorage, path, lastTimeRef.current, lastDurationRef.current);
            }, POSITION_SAVE_DELAY_MS);
        }
    };

    const handleEnded = () => {
        setPlaying(false);
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        const path = pathRef.current;
        if (path) removeWatchedPosition(window.localStorage, path);
        lastTimeRef.current = 0;
        refreshWatched();
        if (autoplayNext && visible.length > 1) navigateVideo(1);
    };

    const handleError = (event: SyntheticEvent<HTMLVideoElement>) => {
        const code = event.currentTarget.error?.code;
        setStatus("error");
        setErrorMessage(
            code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
                ? "This video format is not supported by the built-in player."
                : "The video could not be loaded. The file may have moved or be unreadable.",
        );
    };

    const handleRetry = () => {
        const video = videoRef.current;
        if (!video) return;
        setErrorMessage("");
        setStatus("loading");
        video.load();
    };

    /* Keyboard transport: ignored while typing, speed menu gets Escape first. */
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (isEditableTarget(event.target)) return;

            const key = event.key;
            const lower = key.toLowerCase();

            /* A focused button already activates on Space; avoid toggling playback twice. */
            if (
                (key === " " || key === "Spacebar") &&
                event.target instanceof HTMLElement &&
                (event.target.tagName === "BUTTON" || event.target.tagName === "A")
            ) {
                return;
            }

            if (key === " " || key === "Spacebar") {
                if (!selected) return;
                event.preventDefault();
                togglePlay();
                return;
            }

            switch (key) {
                case "ArrowLeft":
                    if (!selected) return;
                    event.preventDefault();
                    seekBy(-SEEK_STEP_SECONDS);
                    return;
                case "ArrowRight":
                    if (!selected) return;
                    event.preventDefault();
                    seekBy(SEEK_STEP_SECONDS);
                    return;
                case "ArrowUp":
                    if (!selected) return;
                    event.preventDefault();
                    adjustVolume(VOLUME_STEP);
                    return;
                case "ArrowDown":
                    if (!selected) return;
                    event.preventDefault();
                    adjustVolume(-VOLUME_STEP);
                    return;
                case "Escape":
                    event.preventDefault();
                    if (speedMenuOpen) {
                        setSpeedMenuOpen(false);
                        return;
                    }
                    onClose();
                    return;
                default:
                    break;
            }

            if (lower === "m") {
                event.preventDefault();
                setMuted((previous) => !previous);
            } else if (lower === "f") {
                event.preventDefault();
                toggleFullscreen();
            } else if (lower === "n") {
                event.preventDefault();
                goNext();
            } else if (lower === "p") {
                event.preventDefault();
                goPrev();
            } else if (lower === "t") {
                event.preventDefault();
                setTheater((previous) => !previous);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [adjustVolume, goNext, goPrev, onClose, seekBy, selected, speedMenuOpen, toggleFullscreen, togglePlay]);

    const handleRefresh = () => {
        flushPosition();
        setRefreshToken((token) => token + 1);
    };

    const applyCustomRoot = (path: string) => {
        setCustomRoot(path);
        try {
            window.localStorage.setItem(CUSTOM_ROOT_KEY, path);
        } catch {
            /* storage unavailable; keep it for this session */
        }
        setRefreshToken((token) => token + 1);
    };

    const handleChooseFolder = () => {
        void promptSelectDir((selected) => {
            const path = Array.isArray(selected) ? selected[0] : selected;
            if (path) applyCustomRoot(path);
        });
    };

    const handleUseLibraryFolders = () => {
        setCustomRoot("");
        try {
            window.localStorage.removeItem(CUSTOM_ROOT_KEY);
        } catch {
            /* ignore */
        }
        setRefreshToken((token) => token + 1);
    };

    const handleClose = () => {
        flushPosition();
        onClose();
    };

    const scanNote = customRoot
        ? `Custom folder · ${DEFAULT_SCAN_MAX_DEPTH} levels deep`
        : roots.length === 0
          ? "No library folder is configured."
          : `Scanning ${roots.length} folder${roots.length === 1 ? "" : "s"} · ${DEFAULT_SCAN_MAX_DEPTH} levels deep`;

    const videoSrc = useMemo(() => (selected ? absolutePathToFileUrl(selected.path) : ""), [selected]);

    return (
        <div className="mediaPanelOverlay" role="dialog" aria-modal="true" aria-label="Media library">
            <div ref={panelRef} className={`mediaPanel${theater ? " is-theater" : ""}`} tabIndex={-1}>
                <header className="mediaPanelHeader">
                    <div className="mediaPanelBrand">
                        <span className="mediaPanelBrandIcon" aria-hidden>
                            <FontAwesomeIcon icon={faFilm} />
                        </span>
                        <span className="mediaPanelBrandText">
                            <span className="mediaPanelBrandTitle">Media</span>
                            <span className="mediaPanelBrandSubtitle">Local videos</span>
                        </span>
                    </div>

                    <div className="mediaPanelSearch">
                        <FontAwesomeIcon icon={faMagnifyingGlass} className="mediaPanelSearchIcon" aria-hidden />
                        <input
                            type="search"
                            value={query}
                            placeholder="Search titles or paths"
                            aria-label="Search videos"
                            spellCheck={false}
                            onChange={(event) => setQuery(event.currentTarget.value)}
                        />
                        {query ? (
                            <button
                                type="button"
                                className="mediaPanelSearchClear"
                                aria-label="Clear search"
                                title="Clear search"
                                onClick={() => setQuery("")}
                            >
                                <FontAwesomeIcon icon={faXmark} />
                            </button>
                        ) : null}
                    </div>

                    <div className="mediaPanelHeaderActions">
                        <label className="mediaPanelSort">
                            <span>Sort</span>
                            <select
                                value={sort}
                                aria-label="Sort videos"
                                onChange={(event) =>
                                    setSort(event.currentTarget.value === "name" ? "name" : "newest")
                                }
                            >
                                <option value="newest">Newest</option>
                                <option value="name">Name</option>
                            </select>
                        </label>

                        <button
                            type="button"
                            className={`mediaPanelIconButton${scanState === "scanning" ? " is-spinning" : ""}`}
                            aria-label="Rescan library"
                            title="Rescan library"
                            disabled={roots.length === 0 || scanState === "scanning"}
                            onClick={handleRefresh}
                        >
                            <FontAwesomeIcon icon={faArrowsRotate} />
                        </button>

                        <button
                            type="button"
                            className="mediaPanelIconButton"
                            aria-label="Close media panel"
                            title="Close (Esc)"
                            onClick={handleClose}
                        >
                            <FontAwesomeIcon icon={faXmark} />
                        </button>
                    </div>
                </header>

                <div className="mediaPanelSourceBar">
                    <span className="mediaPanelSourcePath" title={customRoot || "Configured library folders"}>
                        <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
                        <span>{customRoot || "Library folders"}</span>
                    </span>
                    <button
                        type="button"
                        className="mediaPanelSourceButton"
                        title="Choose a media folder"
                        onClick={handleChooseFolder}
                    >
                        Choose folder
                    </button>
                    {customRoot ? (
                        <button
                            type="button"
                            className="mediaPanelSourceButton"
                            title="Scan the configured library folders instead"
                            onClick={handleUseLibraryFolders}
                        >
                            Use library
                        </button>
                    ) : null}
                </div>

                <div className="mediaPanelBody">
                    <main className="mediaPanelMain">
                        {selected ? (
                            <>
                                <div ref={stageRef} className="mediaPanelStage">
                                    {/* biome-ignore lint/a11y/useMediaCaption: local library videos ship no caption tracks */}
                                    <video
                                        key={selected.path}
                                        ref={videoRef}
                                        className="mediaPanelVideo"
                                        src={videoSrc}
                                        playsInline
                                        preload="auto"
                                        onClick={togglePlay}
                                        onLoadedMetadata={handleLoadedMetadata}
                                        onCanPlay={handleCanPlay}
                                        onPlaying={handlePlaying}
                                        onPause={handlePause}
                                        onWaiting={handleWaiting}
                                        onProgress={handleProgress}
                                        onTimeUpdate={handleTimeUpdate}
                                        onDurationChange={(event) =>
                                            setDuration(
                                                Number.isFinite(event.currentTarget.duration)
                                                    ? event.currentTarget.duration
                                                    : 0,
                                            )
                                        }
                                        onEnded={handleEnded}
                                        onError={handleError}
                                    />

                                    {!playing && status === "ready" ? (
                                        <button
                                            type="button"
                                            className="mediaPanelCenterPlay"
                                            aria-label="Play video"
                                            title="Play (Space)"
                                            onClick={togglePlay}
                                        >
                                            <FontAwesomeIcon icon={faPlay} />
                                        </button>
                                    ) : null}

                                    {(status === "loading" || buffering) && status !== "error" ? (
                                        <div className="mediaPanelStageSpinner" aria-hidden>
                                            <span className="mediaPanelSpinner" />
                                        </div>
                                    ) : null}

                                    {status === "error" ? (
                                        <div className="mediaPanelStageState" role="alert">
                                            <span className="mediaPanelStageStateTitle">
                                                Unable to play this video
                                            </span>
                                            <span className="mediaPanelStageStateText">{errorMessage}</span>
                                            <button
                                                type="button"
                                                className="mediaPanelButton"
                                                onClick={handleRetry}
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    ) : null}

                                    <MediaPlayerControls
                                        src={videoSrc}
                                        playing={playing}
                                        currentTime={currentTime}
                                        duration={duration}
                                        bufferedTime={bufferedTime}
                                        volume={volume}
                                        muted={muted}
                                        rate={rate}
                                        fullscreen={isFullscreen}
                                        theater={theater}
                                        pipActive={pipActive}
                                        pipSupported={pipSupported}
                                        canNavigate={visible.length > 1}
                                        speedMenuOpen={speedMenuOpen}
                                        onTogglePlay={togglePlay}
                                        onSeek={seekTo}
                                        onToggleMute={toggleMute}
                                        onVolumeChange={changeVolume}
                                        onRateChange={setRate}
                                        onPrevious={goPrev}
                                        onNext={goNext}
                                        onToggleFullscreen={toggleFullscreen}
                                        onToggleTheater={() => setTheater((previous) => !previous)}
                                        onTogglePictureInPicture={togglePictureInPicture}
                                        onToggleSpeedMenu={() => setSpeedMenuOpen((open) => !open)}
                                        onCloseSpeedMenu={() => setSpeedMenuOpen(false)}
                                    />
                                </div>

                                <div className="mediaPanelDetail">
                                    <h1 className="mediaPanelVideoTitle" title={selected.title}>
                                        {selected.title}
                                    </h1>
                                    <div className="mediaPanelVideoMeta">
                                        <span className="mediaPanelChip">{extensionLabel(selected.path)}</span>
                                        <span>{formatBytes(selected.sizeBytes)}</span>
                                        <span className="mediaPanelMetaDot" aria-hidden />
                                        <span>{formatMediaDate(selected.modifiedMs)}</span>
                                        <span className="mediaPanelMetaDot" aria-hidden />
                                        <button
                                            type="button"
                                            className="mediaPanelPathButton"
                                            title={`Show in folder: ${selected.path}`}
                                            onClick={() => window.electron.showItemInFolder(selected.path)}
                                        >
                                            <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
                                            <span>{window.path.dirname(selected.path)}</span>
                                        </button>
                                    </div>
                                </div>

                                {continueItems.length > 0 ? (
                                    <section
                                        className="mediaPanelSection"
                                        aria-labelledby="mediaPanelContinueTitle"
                                    >
                                        <div className="mediaPanelSectionHead">
                                            <h2 id="mediaPanelContinueTitle" className="mediaPanelSectionTitle">
                                                <FontAwesomeIcon icon={faClockRotateLeft} aria-hidden />
                                                <span>Continue watching</span>
                                            </h2>
                                            <span className="mediaPanelSectionCount">{continueItems.length}</span>
                                        </div>

                                        <div className="mediaPanelContinueRow">
                                            {continueItems.map(({ entry, position }) => {
                                                const fraction =
                                                    position.duration > 0
                                                        ? clamp01(position.time / position.duration)
                                                        : 0;
                                                const remaining = Math.max(0, position.duration - position.time);
                                                return (
                                                    <button
                                                        key={entry.path}
                                                        type="button"
                                                        className="mediaPanelContinueCard"
                                                        title={`${entry.title}\n${entry.path}`}
                                                        onClick={() => selectVideo(entry.path)}
                                                    >
                                                        <span className="mediaPanelContinueArt" aria-hidden>
                                                            <FontAwesomeIcon icon={faFilm} />
                                                            <span>{extensionLabel(entry.path)}</span>
                                                        </span>
                                                        <span className="mediaPanelContinueBody">
                                                            <span className="mediaPanelContinueTitle">
                                                                {entry.title}
                                                            </span>
                                                            <span className="mediaPanelContinueMeta">
                                                                {remaining > 0
                                                                    ? `${formatTime(remaining)} left`
                                                                    : `Resume at ${formatTime(position.time)}`}
                                                            </span>
                                                            <span className="mediaPanelMiniProgress" aria-hidden>
                                                                <span
                                                                    style={{
                                                                        width: `${Math.round(fraction * 100)}%`,
                                                                    }}
                                                                />
                                                            </span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </section>
                                ) : null}
                            </>
                        ) : (
                            <div className="mediaPanelBlank">
                                {scanState === "scanning" ? (
                                    <>
                                        <span className="mediaPanelSpinner" aria-hidden />
                                        <span className="mediaPanelBlankTitle">Scanning your library…</span>
                                        <span className="mediaPanelBlankText">{scanNote}</span>
                                    </>
                                ) : roots.length === 0 ? (
                                    <>
                                        <FontAwesomeIcon
                                            icon={faFolderOpen}
                                            className="mediaPanelBlankIcon"
                                            aria-hidden
                                        />
                                        <span className="mediaPanelBlankTitle">No library folder configured</span>
                                        <span className="mediaPanelBlankText">
                                            Add a folder under Settings → Library, then refresh this panel.
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <FontAwesomeIcon
                                            icon={faFilm}
                                            className="mediaPanelBlankIcon"
                                            aria-hidden
                                        />
                                        <span className="mediaPanelBlankTitle">No videos found</span>
                                        <span className="mediaPanelBlankText">
                                            Put `.mp4` or `.webm` files in your library folder and use refresh to
                                            rescan.
                                        </span>
                                    </>
                                )}
                            </div>
                        )}
                    </main>

                    <aside className="mediaPanelSidebar" aria-label="Up next">
                        <div className="mediaPanelSidebarHead">
                            <div className="mediaPanelSidebarTitleBlock">
                                <span className="mediaPanelSidebarTitle">Up next</span>
                                <span className="mediaPanelSidebarCount">
                                    {query.trim()
                                        ? `${visible.length} of ${entries.length} videos`
                                        : `${entries.length} video${entries.length === 1 ? "" : "s"}`}
                                </span>
                            </div>
                            <button
                                type="button"
                                className={`mediaPanelAutoplay${autoplayNext ? " is-on" : ""}`}
                                aria-pressed={autoplayNext}
                                title="Play the next video automatically"
                                onClick={() => setAutoplayNext((previous) => !previous)}
                            >
                                <FontAwesomeIcon icon={faRepeat} aria-hidden />
                                <span>Autoplay</span>
                                <span className="mediaPanelAutoplayDot" aria-hidden />
                            </button>
                        </div>

                        {scanState === "scanning" && entries.length === 0 ? (
                            <div className="mediaPanelListEmpty">
                                <span className="mediaPanelSpinner" aria-hidden />
                                <span>Scanning for videos…</span>
                            </div>
                        ) : visible.length === 0 ? (
                            <div className="mediaPanelListEmpty">
                                <FontAwesomeIcon icon={faFilm} aria-hidden />
                                <span>
                                    {entries.length === 0
                                        ? "No videos in your library yet."
                                        : "No videos match this search."}
                                </span>
                            </div>
                        ) : (
                            <ul className="mediaPanelList">
                                {visible.map((item, index) => {
                                    const active = selected
                                        ? normalizeVideoPath(item.path) === normalizeVideoPath(selected.path)
                                        : false;
                                    const saved = watchedByPath.get(normalizeVideoPath(item.path));
                                    const fraction =
                                        saved && saved.duration > 0 ? clamp01(saved.time / saved.duration) : 0;
                                    return (
                                        <li key={item.path}>
                                            <button
                                                type="button"
                                                className={`mediaPanelListItem${active ? " is-active" : ""}`}
                                                aria-current={active ? "true" : undefined}
                                                title={`${item.title}\n${item.path}`}
                                                onClick={() => selectVideo(item.path)}
                                            >
                                                <span className="mediaPanelListIndex">
                                                    {String(index + 1).padStart(2, "0")}
                                                </span>
                                                <span className="mediaPanelListBody">
                                                    <span className="mediaPanelListTitle">{item.title}</span>
                                                    <span className="mediaPanelListMeta">
                                                        <span className="mediaPanelListFolder">
                                                            {folderLabel(item.path)}
                                                        </span>
                                                        <span className="mediaPanelMetaDot" aria-hidden />
                                                        <span>{formatBytes(item.sizeBytes)}</span>
                                                        <span className="mediaPanelMetaDot" aria-hidden />
                                                        <span>{formatMediaDate(item.modifiedMs)}</span>
                                                    </span>
                                                    {saved && fraction > 0 && fraction < 1 ? (
                                                        <span className="mediaPanelMiniProgress" aria-hidden>
                                                            <span
                                                                style={{
                                                                    width: `${Math.round(fraction * 100)}%`,
                                                                }}
                                                            />
                                                        </span>
                                                    ) : null}
                                                </span>
                                                <span className="mediaPanelListBadge">
                                                    {extensionLabel(item.path)}
                                                </span>
                                            </button>
                                        </li>
                                    );
                                })}
                            </ul>
                        )}

                        {scanErrors.length > 0 ? (
                            <div
                                className="mediaPanelScanNote"
                                title={scanErrors.map((error) => `${error.path}: ${error.message}`).join("\n")}
                            >
                                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                                <span>
                                    {scanErrors.length} path
                                    {scanErrors.length === 1 ? "" : "s"} could not be read
                                </span>
                            </div>
                        ) : null}
                    </aside>
                </div>
            </div>
        </div>
    );
};

export default MediaPanel;
