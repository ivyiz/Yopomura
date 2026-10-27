import {
    faBackwardStep,
    faFolderOpen,
    faForwardStep,
    faListUl,
    faPlay,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { absolutePathToFileUrl } from "@utils/libraryCover";
import type { SyntheticEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    buildVideoPlaylist,
    findVideoIndex,
    nextVideo,
    normalizeVideoPath,
    prevVideo,
    sortVideoItems,
    videoTitleFromPath,
} from "./playlist";
import "./videoPlayer.scss";

/** A sibling video shown in the playlist panel. */
export type VideoItem = { path: string; title: string };

export type VideoPlayerProps = {
    /** Absolute path of the video to show. */
    link: string;
    /** Sibling videos from the same folder; the active {@link link} may be missing and is added. */
    playlist: VideoItem[];
    onClose: () => void;
    onNavigate: (path: string) => void;
};

/** localStorage prefix for the resume position of one file. */
const POSITION_KEY_PREFIX = "yokomura-video-pos:";

/** Minimum gap between position writes while the video plays. */
const POSITION_SAVE_DELAY_MS = 1000;

/** Positions this close to the end are treated as finished and cleared. */
const END_CLEAR_THRESHOLD_SECONDS = 3;

const SEEK_STEP_SECONDS = 5;
const VOLUME_STEP = 0.05;

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

type PlayerStatus = "loading" | "ready" | "error";

const positionStorageKey = (path: string): string => `${POSITION_KEY_PREFIX}${path}`;

/** Reads a saved resume position; malformed or unavailable storage yields `0`. */
const readSavedPosition = (path: string): number => {
    try {
        const raw = window.localStorage.getItem(positionStorageKey(path));
        if (!raw) return 0;
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
        return 0;
    }
};

/** Removes a resume position; storage failures are non-fatal. */
const removeSavedPosition = (path: string): void => {
    try {
        window.localStorage.removeItem(positionStorageKey(path));
    } catch {
        // localStorage can be unavailable or full - playback must keep working
    }
};

/**
 * Persists a resume position, clearing it when playback reached the end.
 * Non-finite/zero times are ignored so a not-yet-started file leaves no entry.
 */
const writeSavedPosition = (path: string, time: number, duration: number): void => {
    if (!Number.isFinite(time) || time <= 0) return;
    if (Number.isFinite(duration) && duration > 0 && duration - time <= END_CLEAR_THRESHOLD_SECONDS) {
        removeSavedPosition(path);
        return;
    }
    try {
        window.localStorage.setItem(positionStorageKey(path), time.toFixed(2));
    } catch {
        // ignore storage failures
    }
};

/** Keyboard handlers ignore typing targets so shortcuts never steal text input. */
const isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    return (
        target.tagName === "INPUT" ||
        target.tagName === "SELECT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
    );
};

/**
 * Self-contained full-screen video player with resume support, sibling playlist navigation,
 * playback-rate control, and keyboard shortcuts.
 *
 * The parent owns `link`/`playlist` and is responsible for rendering this component only while
 * a video is open.
 */
const VideoPlayer = ({ link, playlist, onClose, onNavigate }: VideoPlayerProps) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const linkRef = useRef(link);
    const saveTimerRef = useRef<number | null>(null);
    const lastTimeRef = useRef(0);
    const lastDurationRef = useRef(0);

    const [playlistOpen, setPlaylistOpen] = useState(true);
    const [rate, setRate] = useState(1);
    const [status, setStatus] = useState<PlayerStatus>("loading");
    const [errorMessage, setErrorMessage] = useState("");

    const videos = useMemo(() => {
        const existing = buildVideoPlaylist(playlist);
        const activeKey = normalizeVideoPath(link);
        if (existing.some((item) => normalizeVideoPath(item.path) === activeKey)) return existing;
        return sortVideoItems([...existing, { path: link, title: videoTitleFromPath(link) }]);
    }, [link, playlist]);

    const activeIndex = useMemo(() => findVideoIndex(videos, link), [link, videos]);
    const activeItem = activeIndex >= 0 ? videos[activeIndex] : undefined;
    const title = activeItem?.title || videoTitleFromPath(link);
    const videoSrc = useMemo(() => absolutePathToFileUrl(link), [link]);
    const canNavigate = videos.length > 1;

    /** Writes the latest observed position immediately (used before closing/navigating). */
    const flushPosition = useCallback(() => {
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        writeSavedPosition(linkRef.current, lastTimeRef.current, lastDurationRef.current);
    }, []);

    useEffect(() => {
        linkRef.current = link;
        lastTimeRef.current = 0;
        lastDurationRef.current = 0;
        setStatus("loading");
        setErrorMessage("");
    }, [link]);

    /* Flush the outgoing file when the link changes and the current file on unmount. */
    useEffect(() => {
        return () => {
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            writeSavedPosition(link, lastTimeRef.current, lastDurationRef.current);
        };
    }, [link]);

    useEffect(() => {
        if (videoRef.current) videoRef.current.playbackRate = rate;
    }, [rate]);

    /* Focus the overlay for keyboard use and restore the previous element on close. */
    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        containerRef.current?.focus({ preventScroll: true });
        return () => previous?.focus({ preventScroll: true });
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

    const seekBy = useCallback((deltaSeconds: number) => {
        const video = videoRef.current;
        if (!video) return;
        const duration = video.duration;
        const target = video.currentTime + deltaSeconds;
        if (!Number.isFinite(duration) || duration <= 0) {
            video.currentTime = Math.max(0, target);
            return;
        }
        video.currentTime = Math.min(Math.max(0, target), Math.max(0, duration - 0.05));
    }, []);

    const adjustVolume = useCallback((delta: number) => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = false;
        video.volume = Math.min(1, Math.max(0, Math.round((video.volume + delta) * 100) / 100));
    }, []);

    const toggleMute = useCallback(() => {
        const video = videoRef.current;
        if (video) video.muted = !video.muted;
    }, []);

    const toggleFullscreen = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => undefined);
            return;
        }
        void container.requestFullscreen().catch(() => undefined);
    }, []);

    const handleClose = useCallback(() => {
        flushPosition();
        onClose();
    }, [flushPosition, onClose]);

    const navigateTo = useCallback(
        (path: string) => {
            if (normalizeVideoPath(path) === normalizeVideoPath(linkRef.current)) return;
            flushPosition();
            onNavigate(path);
        },
        [flushPosition, onNavigate],
    );

    const goToNext = useCallback(() => {
        const target = nextVideo(videos, linkRef.current);
        if (target) navigateTo(target.path);
    }, [navigateTo, videos]);

    const goToPrev = useCallback(() => {
        const target = prevVideo(videos, linkRef.current);
        if (target) navigateTo(target.path);
    }, [navigateTo, videos]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented) return;
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (isEditableTarget(event.target)) return;

            const key = event.key;
            const lower = key.toLowerCase();

            if (key === " " || key === "Spacebar") {
                event.preventDefault();
                togglePlay();
                return;
            }

            switch (key) {
                case "ArrowLeft":
                    event.preventDefault();
                    seekBy(-SEEK_STEP_SECONDS);
                    return;
                case "ArrowRight":
                    event.preventDefault();
                    seekBy(SEEK_STEP_SECONDS);
                    return;
                case "ArrowUp":
                    event.preventDefault();
                    adjustVolume(VOLUME_STEP);
                    return;
                case "ArrowDown":
                    event.preventDefault();
                    adjustVolume(-VOLUME_STEP);
                    return;
                case "Escape":
                    event.preventDefault();
                    handleClose();
                    return;
                default:
                    break;
            }

            if (lower === "m") {
                event.preventDefault();
                toggleMute();
            } else if (lower === "f") {
                event.preventDefault();
                toggleFullscreen();
            } else if (lower === "n") {
                event.preventDefault();
                goToNext();
            } else if (lower === "p") {
                event.preventDefault();
                goToPrev();
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [adjustVolume, goToNext, goToPrev, handleClose, seekBy, toggleFullscreen, toggleMute, togglePlay]);

    const handleLoadedMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        video.playbackRate = rate;

        const saved = readSavedPosition(link);
        if (saved > 0) {
            const duration = video.duration;
            if (!Number.isFinite(duration) || saved < duration - END_CLEAR_THRESHOLD_SECONDS) {
                try {
                    video.currentTime = saved;
                } catch {
                    // seeking can fail before the media is seekable; the position stays saved
                }
            } else {
                removeSavedPosition(link);
            }
        }

        lastTimeRef.current = video.currentTime;
        lastDurationRef.current = video.duration;
    };

    const handleTimeUpdate = (event: SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        const time = video.currentTime;
        const duration = video.duration;
        lastTimeRef.current = time;
        lastDurationRef.current = duration;

        /* Near the end the resume entry is meaningless; drop it immediately. */
        if (Number.isFinite(duration) && duration > 0 && duration - time <= END_CLEAR_THRESHOLD_SECONDS) {
            if (saveTimerRef.current !== null) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
            removeSavedPosition(link);
            return;
        }

        /* Trailing one-second throttle: timeupdate fires several times per second. */
        if (saveTimerRef.current === null) {
            saveTimerRef.current = window.setTimeout(() => {
                saveTimerRef.current = null;
                writeSavedPosition(link, lastTimeRef.current, lastDurationRef.current);
            }, POSITION_SAVE_DELAY_MS);
        }
    };

    const handlePause = (event: SyntheticEvent<HTMLVideoElement>) => {
        const video = event.currentTarget;
        lastTimeRef.current = video.currentTime;
        lastDurationRef.current = video.duration;
        writeSavedPosition(link, video.currentTime, video.duration);
    };

    const handleEnded = () => {
        if (saveTimerRef.current !== null) {
            window.clearTimeout(saveTimerRef.current);
            saveTimerRef.current = null;
        }
        lastTimeRef.current = 0;
        removeSavedPosition(link);
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
        void video.play().catch(() => undefined);
    };

    return (
        <div
            ref={containerRef}
            className="videoPlayerOverlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Video player: ${title}`}
            tabIndex={-1}
        >
            <header className="videoPlayerHeader">
                <div className="videoPlayerTitleBlock">
                    <span className="videoPlayerEyebrow">Now playing</span>
                    <h2 className="videoPlayerTitle" title={title}>
                        {title}
                    </h2>
                </div>
                <div className="videoPlayerActions">
                    <button
                        type="button"
                        className={`videoPlayerButton${playlistOpen ? " is-active" : ""}`}
                        aria-label={playlistOpen ? "Hide playlist" : "Show playlist"}
                        aria-expanded={playlistOpen}
                        aria-controls="videoPlayerPlaylist"
                        title={playlistOpen ? "Hide playlist" : "Show playlist"}
                        onClick={() => setPlaylistOpen((open) => !open)}
                    >
                        <FontAwesomeIcon icon={faListUl} />
                        <span className="videoPlayerButtonLabel">Playlist</span>
                    </button>
                    <button
                        type="button"
                        className="videoPlayerButton"
                        aria-label="Open in File Explorer"
                        title="Open in File Explorer"
                        onClick={() => window.electron.showItemInFolder(link)}
                    >
                        <FontAwesomeIcon icon={faFolderOpen} />
                        <span className="videoPlayerButtonLabel">Open in File Explorer</span>
                    </button>
                    <button
                        type="button"
                        className="videoPlayerButton videoPlayerIconButton"
                        aria-label="Close video player"
                        onClick={handleClose}
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>
            </header>

            <div className="videoPlayerBody">
                <div className="videoPlayerStage">
                    <div className="videoPlayerFrame">
                        {/* biome-ignore lint/a11y/useMediaCaption: local library videos ship no caption tracks */}
                        <video
                            key={link}
                            ref={videoRef}
                            className="videoPlayerVideo"
                            src={videoSrc}
                            controls
                            autoPlay
                            playsInline
                            preload="metadata"
                            onLoadedMetadata={handleLoadedMetadata}
                            onCanPlay={() => setStatus("ready")}
                            onPlaying={() => setStatus("ready")}
                            onWaiting={() => setStatus("loading")}
                            onTimeUpdate={handleTimeUpdate}
                            onPause={handlePause}
                            onEnded={handleEnded}
                            onError={handleError}
                        />

                        {status === "loading" ? (
                            <div className="videoPlayerState">
                                <span className="videoPlayerSpinner" aria-hidden />
                                <span className="videoPlayerStateTitle">Loading video…</span>
                            </div>
                        ) : null}

                        {status === "error" ? (
                            <div className="videoPlayerState is-error" role="alert">
                                <span className="videoPlayerStateTitle">Unable to play this video</span>
                                <span className="videoPlayerStateText">{errorMessage}</span>
                                <button type="button" className="videoPlayerButton" onClick={handleRetry}>
                                    Retry
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <div className="videoPlayerFooter">
                        <button
                            type="button"
                            className="videoPlayerButton"
                            aria-label="Previous video"
                            onClick={goToPrev}
                            disabled={!canNavigate}
                        >
                            <FontAwesomeIcon icon={faBackwardStep} />
                            <span className="videoPlayerButtonLabel">Previous</span>
                        </button>

                        <span className="videoPlayerPosition">
                            {activeIndex >= 0 ? `${activeIndex + 1} / ${videos.length}` : `1 / ${videos.length}`}
                        </span>

                        <button
                            type="button"
                            className="videoPlayerButton"
                            aria-label="Next video"
                            onClick={goToNext}
                            disabled={!canNavigate}
                        >
                            <span className="videoPlayerButtonLabel">Next</span>
                            <FontAwesomeIcon icon={faForwardStep} />
                        </button>

                        <span className="videoPlayerSpacer" />

                        <label className="videoPlayerRate">
                            <span>Speed</span>
                            <span className="videoPlayerSelectWrap">
                                <select
                                    value={rate}
                                    aria-label="Playback speed"
                                    onChange={(event) => {
                                        const nextRate = Number(event.currentTarget.value);
                                        if (Number.isFinite(nextRate)) setRate(nextRate);
                                    }}
                                >
                                    {PLAYBACK_RATES.map((value) => (
                                        <option key={value} value={value}>
                                            {value}×
                                        </option>
                                    ))}
                                </select>
                            </span>
                        </label>

                        <span className="videoPlayerHint" aria-hidden>
                            Space play/pause · ←/→ seek · ↑/↓ volume · M mute · F fullscreen · N/P next/prev
                        </span>
                    </div>
                </div>

                {playlistOpen ? (
                    <aside id="videoPlayerPlaylist" className="videoPlayerPlaylist" aria-label="Playlist">
                        <div className="videoPlayerPlaylistHead">
                            <span className="videoPlayerPlaylistTitle">Playlist</span>
                            <span className="videoPlayerPlaylistCount">
                                {videos.length} video{videos.length === 1 ? "" : "s"}
                            </span>
                        </div>
                        <ul className="videoPlayerPlaylistList">
                            {videos.map((item, index) => {
                                const active = normalizeVideoPath(item.path) === normalizeVideoPath(link);
                                return (
                                    <li key={`${item.path}:${index}`}>
                                        <button
                                            type="button"
                                            className={`videoPlayerPlaylistItem${active ? " is-active" : ""}`}
                                            aria-current={active ? "true" : undefined}
                                            title={item.title}
                                            onClick={() => navigateTo(item.path)}
                                        >
                                            <span className="videoPlayerPlaylistIndex">
                                                {String(index + 1).padStart(2, "0")}
                                            </span>
                                            <span className="videoPlayerPlaylistName">{item.title}</span>
                                            {active ? (
                                                <FontAwesomeIcon
                                                    icon={faPlay}
                                                    className="videoPlayerPlaylistPlaying"
                                                    aria-hidden
                                                />
                                            ) : null}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    </aside>
                ) : null}
            </div>
        </div>
    );
};

export default VideoPlayer;
