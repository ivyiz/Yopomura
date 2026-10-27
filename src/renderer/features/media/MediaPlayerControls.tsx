import {
    faBackwardStep,
    faClone,
    faCompress,
    faExpand,
    faForwardStep,
    faPause,
    faPlay,
    faRectangleList,
    faVolumeHigh,
    faVolumeLow,
    faVolumeXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatTime, seekPreviewLeft } from "./mediaLibrary";

/** Playback rates offered by the compact speed popover. */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

/** Width of the hover preview card; mirrored by `--mediaPanelPreviewWidth` in SCSS. */
const PREVIEW_CARD_WIDTH = 168;

/** Minimum gap between preview seeks, so dragging cannot flood the decoder. */
const PREVIEW_SEEK_INTERVAL_MS = 120;

export type MediaPlayerControlsProps = {
    src: string;
    playing: boolean;
    currentTime: number;
    duration: number;
    bufferedTime: number;
    volume: number;
    muted: boolean;
    rate: number;
    fullscreen: boolean;
    theater: boolean;
    pipActive: boolean;
    pipSupported: boolean;
    canNavigate: boolean;
    speedMenuOpen: boolean;
    onTogglePlay: () => void;
    onSeek: (time: number) => void;
    onToggleMute: () => void;
    onVolumeChange: (volume: number) => void;
    onRateChange: (rate: number) => void;
    onPrevious: () => void;
    onNext: () => void;
    onToggleFullscreen: () => void;
    onToggleTheater: () => void;
    onTogglePictureInPicture: () => void;
    onToggleSpeedMenu: () => void;
    onCloseSpeedMenu: () => void;
};

const clampFraction = (value: number, max: number): number => {
    if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
    return Math.min(1, Math.max(0, value / max));
};

/**
 * Custom control bar for the media panel: transport, volume, speed popover, theater/PiP/fullscreen,
 * and the hover seek-preview card. Playback state stays in {@link MediaPanel} so keyboard
 * shortcuts can drive it too.
 */
const MediaPlayerControls = ({
    src,
    playing,
    currentTime,
    duration,
    bufferedTime,
    volume,
    muted,
    rate,
    fullscreen,
    theater,
    pipActive,
    pipSupported,
    canNavigate,
    speedMenuOpen,
    onTogglePlay,
    onSeek,
    onToggleMute,
    onVolumeChange,
    onRateChange,
    onPrevious,
    onNext,
    onToggleFullscreen,
    onToggleTheater,
    onTogglePictureInPicture,
    onToggleSpeedMenu,
    onCloseSpeedMenu,
}: MediaPlayerControlsProps) => {
    const speedWrapRef = useRef<HTMLDivElement>(null);
    const seekRef = useRef<HTMLDivElement>(null);
    const previewVideoRef = useRef<HTMLVideoElement>(null);
    const previewTimeRef = useRef(0);
    const previewSeekAtRef = useRef(0);
    const previewSeekTimerRef = useRef<number | null>(null);
    const draggingRef = useRef(false);
    const [preview, setPreview] = useState<{ time: number; left: number } | null>(null);

    /* A click anywhere outside the speed popover dismisses it, like a native menu. */
    useEffect(() => {
        if (!speedMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (!(event.target instanceof Node)) return;
            if (speedWrapRef.current?.contains(event.target)) return;
            onCloseSpeedMenu();
        };
        document.addEventListener("mousedown", handlePointerDown);
        return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [onCloseSpeedMenu, speedMenuOpen]);

    const seekMax = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const played = clampFraction(currentTime, seekMax);
    const buffered = Math.max(played, clampFraction(bufferedTime, seekMax));
    const audibleVolume = muted ? 0 : volume;

    const volumeIcon = useMemo(() => {
        if (muted || volume <= 0) return faVolumeXmark;
        return volume < 0.5 ? faVolumeLow : faVolumeHigh;
    }, [muted, volume]);

    const applyPreviewSeek = useCallback(() => {
        if (previewSeekTimerRef.current !== null) {
            window.clearTimeout(previewSeekTimerRef.current);
            previewSeekTimerRef.current = null;
        }
        previewSeekAtRef.current = performance.now();

        const video = previewVideoRef.current;
        const time = previewTimeRef.current;
        if (!video || !Number.isFinite(time)) return;

        const mediaDuration = video.duration;
        const target =
            Number.isFinite(mediaDuration) && mediaDuration > 0
                ? Math.min(time, Math.max(0, mediaDuration - 0.05))
                : time;

        try {
            /* Small deltas are ignored so a slow drag does not re-decode the same frame. */
            if (Math.abs(video.currentTime - target) > 0.04) video.currentTime = target;
        } catch {
            // the twin video can reject seeks before metadata; the next move retries
        }
    }, []);

    const requestPreviewSeek = useCallback(
        (time: number) => {
            previewTimeRef.current = time;
            const elapsed = performance.now() - previewSeekAtRef.current;

            if (elapsed >= PREVIEW_SEEK_INTERVAL_MS) {
                applyPreviewSeek();
                return;
            }
            if (previewSeekTimerRef.current === null) {
                previewSeekTimerRef.current = window.setTimeout(() => {
                    previewSeekTimerRef.current = null;
                    applyPreviewSeek();
                }, PREVIEW_SEEK_INTERVAL_MS - elapsed);
            }
        },
        [applyPreviewSeek],
    );

    const hidePreview = useCallback(() => {
        if (previewSeekTimerRef.current !== null) {
            window.clearTimeout(previewSeekTimerRef.current);
            previewSeekTimerRef.current = null;
        }
        setPreview(null);
    }, []);

    /* Drop the throttled seek and the card when the player closes or the source changes. */
    useEffect(
        () => () => {
            if (previewSeekTimerRef.current !== null) {
                window.clearTimeout(previewSeekTimerRef.current);
                previewSeekTimerRef.current = null;
            }
        },
        [],
    );

    useEffect(() => {
        if (!src) return;
        previewTimeRef.current = 0;
        previewSeekAtRef.current = 0;
        setPreview(null);
    }, [src]);

    const updatePreview = (clientX: number) => {
        const track = seekRef.current;
        if (!track || seekMax <= 0) {
            setPreview(null);
            return;
        }
        const rect = track.getBoundingClientRect();
        if (rect.width <= 0) return;

        const fraction = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
        const time = fraction * seekMax;

        setPreview({
            time,
            left: seekPreviewLeft(fraction, rect.width, PREVIEW_CARD_WIDTH),
        });
        requestPreviewSeek(time);
    };

    return (
        <div className="mediaPanelControls">
            <div className="mediaPanelSeekRow">
                <span className="mediaPanelTime">{formatTime(currentTime)}</span>
                <div
                    className="mediaPanelSeek"
                    ref={seekRef}
                    onPointerMove={(event) => updatePreview(event.clientX)}
                    onPointerDown={(event) => {
                        draggingRef.current = true;
                        updatePreview(event.clientX);
                    }}
                    onPointerUp={() => {
                        draggingRef.current = false;
                        hidePreview();
                    }}
                    onPointerCancel={() => {
                        draggingRef.current = false;
                        hidePreview();
                    }}
                    onPointerLeave={() => {
                        if (!draggingRef.current) hidePreview();
                    }}
                >
                    <span className="mediaPanelSeekTrack" aria-hidden>
                        <span className="mediaPanelSeekBuffered" style={{ width: `${buffered * 100}%` }} />
                        <span className="mediaPanelSeekPlayed" style={{ width: `${played * 100}%` }} />
                    </span>
                    <span className="mediaPanelSeekThumb" style={{ left: `${played * 100}%` }} aria-hidden />
                    <input
                        type="range"
                        className="mediaPanelSeekInput"
                        min={0}
                        max={seekMax}
                        step={0.1}
                        value={Math.min(currentTime, seekMax)}
                        disabled={seekMax <= 0}
                        aria-label="Seek"
                        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
                        onChange={(event) => onSeek(Number(event.currentTarget.value))}
                    />

                    {/* Muted twin element: the preview card renders the element itself, so local
                        MP4/WebM frames work without canvas tainting or a remote thumbnail service. */}
                    <div
                        className={`mediaPanelSeekPreview${preview ? " is-visible" : ""}`}
                        style={preview ? { left: `${preview.left}px` } : undefined}
                        aria-hidden
                    >
                        <video
                            ref={previewVideoRef}
                            className="mediaPanelSeekPreviewVideo"
                            src={src}
                            muted
                            playsInline
                            preload="metadata"
                            tabIndex={-1}
                            onLoadedMetadata={() => {
                                if (previewTimeRef.current > 0) applyPreviewSeek();
                            }}
                        />
                        <span className="mediaPanelSeekPreviewTime">{formatTime(preview?.time ?? 0)}</span>
                    </div>
                </div>
                <span className="mediaPanelTime is-duration">{formatTime(duration)}</span>
            </div>

            <div className="mediaPanelControlRow">
                <button
                    type="button"
                    className="mediaPanelControlButton is-primary"
                    aria-label={playing ? "Pause" : "Play"}
                    title={playing ? "Pause (Space)" : "Play (Space)"}
                    onClick={onTogglePlay}
                >
                    <FontAwesomeIcon icon={playing ? faPause : faPlay} />
                </button>

                <button
                    type="button"
                    className="mediaPanelControlButton"
                    aria-label="Previous video"
                    title="Previous video (P)"
                    onClick={onPrevious}
                    disabled={!canNavigate}
                >
                    <FontAwesomeIcon icon={faBackwardStep} />
                </button>

                <button
                    type="button"
                    className="mediaPanelControlButton"
                    aria-label="Next video"
                    title="Next video (N)"
                    onClick={onNext}
                    disabled={!canNavigate}
                >
                    <FontAwesomeIcon icon={faForwardStep} />
                </button>

                <div className="mediaPanelVolume">
                    <button
                        type="button"
                        className="mediaPanelControlButton"
                        aria-label={muted ? "Unmute" : "Mute"}
                        aria-pressed={muted}
                        title={muted ? "Unmute (M)" : "Mute (M)"}
                        onClick={onToggleMute}
                    >
                        <FontAwesomeIcon icon={volumeIcon} />
                    </button>
                    <input
                        type="range"
                        className="mediaPanelVolumeRange"
                        min={0}
                        max={1}
                        step={0.01}
                        value={audibleVolume}
                        aria-label="Volume"
                        title={`Volume ${Math.round(audibleVolume * 100)}%`}
                        onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
                    />
                </div>

                <span className="mediaPanelControlSpacer" />

                <div className="mediaPanelSpeedWrap" ref={speedWrapRef}>
                    <button
                        type="button"
                        className={`mediaPanelSpeedButton${speedMenuOpen ? " is-open" : ""}`}
                        aria-label="Playback speed"
                        aria-haspopup="menu"
                        aria-expanded={speedMenuOpen}
                        title="Playback speed"
                        onClick={onToggleSpeedMenu}
                    >
                        {rate}×
                    </button>

                    {speedMenuOpen ? (
                        <div className="mediaPanelSpeedMenu" role="menu" aria-label="Playback speed">
                            {PLAYBACK_RATES.map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked={value === rate}
                                    className={value === rate ? "is-active" : undefined}
                                    onClick={() => {
                                        onRateChange(value);
                                        onCloseSpeedMenu();
                                    }}
                                >
                                    <span>{value}×</span>
                                    {value === rate ? <span className="mediaPanelSpeedCheck">✓</span> : null}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <button
                    type="button"
                    className={`mediaPanelControlButton${theater ? " is-active" : ""}`}
                    aria-label="Theater mode"
                    aria-pressed={theater}
                    title={theater ? "Exit theater mode (T)" : "Theater mode (T)"}
                    onClick={onToggleTheater}
                >
                    <FontAwesomeIcon icon={faRectangleList} />
                </button>

                {pipSupported ? (
                    <button
                        type="button"
                        className={`mediaPanelControlButton${pipActive ? " is-active" : ""}`}
                        aria-label="Picture in picture"
                        aria-pressed={pipActive}
                        title="Picture in picture"
                        onClick={onTogglePictureInPicture}
                    >
                        <FontAwesomeIcon icon={faClone} />
                    </button>
                ) : null}

                <button
                    type="button"
                    className="mediaPanelControlButton"
                    aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                    title={fullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
                    onClick={onToggleFullscreen}
                >
                    <FontAwesomeIcon icon={fullscreen ? faCompress : faExpand} />
                </button>
            </div>
        </div>
    );
};

export default MediaPlayerControls;
