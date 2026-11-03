import {
    ArrowLeft,
    Captions,
    Check,
    Gauge,
    Maximize,
    Maximize2,
    Minimize,
    Pause,
    PictureInPicture2,
    Play,
    RotateCcw,
    RotateCw,
    Volume1,
    Volume2,
    VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { chaptersFor, fmt, type Video } from "./data";
import Frame from "./Frame";
import "./v2Styles.scss";

type Aspect = "16:9" | "Fill" | "Stretch";
const SPEEDS = [0.5, 1, 1.25, 1.5, 2];
const SUBS = ["Off", "English (.srt)", "English (.ass)", "Spanish (.srt)"];
const AUDIO = ["Japanese • 5.1 AAC", "English • 2.0 AAC", "English • 5.1 EAC3"];
const LINES = [
    "You said the signal would hold until dawn.",
    "It did. Just not the way we planned.",
    "Keep your voice down. They are listening.",
    "Then let them hear us this time.",
    "Whatever happens next, we walk out together.",
];

export default function V2Player({ video, onBack }: { video: Video; onBack: () => void }) {
    const [time, setTime] = useState(video.progress || 0);
    const [playing, setPlaying] = useState(true);
    const [volume, setVolume] = useState(0.7);
    const [muted, setMuted] = useState(false);
    const [speed, setSpeed] = useState(1);
    const [aspect, setAspect] = useState<Aspect>("16:9");
    const [sub, setSub] = useState(1);
    const [audio, setAudio] = useState(0);
    const [menu, setMenu] = useState<null | "speed" | "tracks">(null);
    const [full, setFull] = useState(false);
    const [pip, setPip] = useState(false);
    const [hud, setHud] = useState(true);
    const [flash, setFlash] = useState<string | null>(null);
    const idle = useRef(0);
    const chapters = chaptersFor(video);

    useEffect(() => {
        if (!playing) return;
        const t = setInterval(() => {
            setTime((c) => {
                const n = c + 0.25 * speed;
                if (n >= video.dur) {
                    setPlaying(false);
                    return video.dur;
                }
                return n;
            });
        }, 250);
        return () => clearInterval(t);
    }, [playing, speed, video.dur]);

    const wake = useCallback(() => {
        setHud(true);
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(() => setHud(false), 3000);
    }, []);

    useEffect(() => {
        wake();
        window.addEventListener("mousemove", wake);
        return () => {
            window.removeEventListener("mousemove", wake);
            window.clearTimeout(idle.current);
        };
    }, [wake]);

    const show = hud || !playing || !!menu;

    const seek = useCallback(
        (d: number) => {
            setTime((t) => Math.min(video.dur, Math.max(0, t + d)));
            setFlash(d > 0 ? "+10s" : "−10s");
            setTimeout(() => setFlash(null), 600);
        },
        [video.dur],
    );

    const toggleFull = useCallback(() => {
        if (document.fullscreenElement) {
            document.exitFullscreen?.();
        } else {
            document.documentElement.requestFullscreen?.().catch(() => {
                /* fullscreen can be refused by the window manager */
            });
        }
    }, []);

    useEffect(() => {
        const on = () => setFull(!!document.fullscreenElement);
        document.addEventListener("fullscreenchange", on);
        return () => document.removeEventListener("fullscreenchange", on);
    }, []);

    useEffect(() => {
        const k = (e: KeyboardEvent) => {
            wake();
            if (e.key === " ") {
                e.preventDefault();
                setPlaying((p) => !p);
            } else if (e.key === "ArrowLeft") seek(-10);
            else if (e.key === "ArrowRight") seek(10);
            else if (e.key === "ArrowUp") setVolume((v) => Math.min(1, v + 0.05));
            else if (e.key === "ArrowDown") setVolume((v) => Math.max(0, v - 0.05));
            else if (e.key === "m") setMuted((m) => !m);
            else if (e.key === "f") toggleFull();
            else if (e.key === "Escape") {
                if (menu) setMenu(null);
                else if (pip) setPip(false);
                else if (!document.fullscreenElement) onBack();
            }
        };
        window.addEventListener("keydown", k);
        return () => window.removeEventListener("keydown", k);
    });

    const ratio = aspect === "16:9" ? "xMidYMid meet" : aspect === "Fill" ? "xMidYMid slice" : "none";
    const pct = (time / video.dur) * 100;
    const vol = muted ? 0 : volume;
    const VolIcon = vol === 0 ? VolumeX : vol < 0.5 ? Volume1 : Volume2;
    const chapter = [...chapters].reverse().find((c) => time >= c.at)!;

    const timeFrom = (e: React.MouseEvent<HTMLElement>) => {
        const r = e.currentTarget.getBoundingClientRect();
        return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * video.dur;
    };

    const stage = (
        <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
            <Frame seed={video.id} h1={video.h1} h2={video.h2} ratio={ratio} />
            {sub > 0 && (
                <div
                    style={{
                        pointerEvents: "none",
                        position: "absolute",
                        left: 0,
                        right: 0,
                        display: "flex",
                        justifyContent: "center",
                        padding: "0 80px",
                        bottom: show && !pip ? "140px" : "48px",
                        transition: "bottom 200ms ease",
                    }}
                >
                    <span
                        style={{
                            padding: "6px 16px",
                            borderRadius: "var(--v2-radius-md)",
                            backgroundColor: "rgba(0,0,0,0.7)",
                            color: "#ffffff",
                            fontSize: pip ? "12px" : "22px",
                            textAlign: "center",
                        }}
                    >
                        {LINES[Math.floor(time / 5) % LINES.length]}
                    </span>
                </div>
            )}
        </div>
    );

    if (pip) {
        return (
            <div style={{ position: "relative", width: "100%", height: "100%", backgroundColor: "var(--v2-bg)" }}>
                <div
                    style={{
                        display: "flex",
                        height: "100%",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "var(--v2-text-muted)",
                        fontSize: "14px",
                    }}
                >
                    Playing in Picture-in-Picture
                </div>
                <div
                    style={{
                        position: "absolute",
                        right: 24,
                        bottom: 24,
                        aspectRatio: "16/9",
                        width: "420px",
                        overflow: "hidden",
                        borderRadius: "var(--v2-radius-lg)",
                        border: "1px solid var(--v2-border-strong)",
                        backgroundColor: "var(--v2-bg)",
                    }}
                >
                    {stage}
                    <div
                        style={{
                            position: "absolute",
                            inset: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "12px",
                            backgroundColor: "rgba(0,0,0,0.4)",
                        }}
                    >
                        <button
                            className="v2-btn"
                            style={{
                                width: "40px",
                                height: "40px",
                                borderRadius: "50%",
                                backgroundColor: "rgba(255,255,255,0.2)",
                            }}
                            onClick={() => setPlaying((p) => !p)}
                        >
                            {playing ? (
                                <Pause size={18} fill="currentColor" />
                            ) : (
                                <Play size={18} fill="currentColor" />
                            )}
                        </button>
                        <button
                            className="v2-btn"
                            style={{
                                height: "36px",
                                padding: "0 14px",
                                borderRadius: "999px",
                                backgroundColor: "rgba(255,255,255,0.2)",
                            }}
                            onClick={() => setPip(false)}
                        >
                            <Maximize2 size={14} />
                            Return
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                backgroundColor: "#000000",
                overflow: "hidden",
                userSelect: "none",
            }}
        >
            {stage}

            {/* Flash Feedback */}
            {flash && (
                <div
                    style={{
                        pointerEvents: "none",
                        position: "absolute",
                        inset: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <span
                        style={{
                            padding: "12px 24px",
                            borderRadius: "var(--v2-radius-md)",
                            backgroundColor: "rgba(0,0,0,0.7)",
                            fontSize: "24px",
                            fontWeight: 600,
                            color: "#ffffff",
                        }}
                    >
                        {flash}
                    </span>
                </div>
            )}

            {/* Top Bar HUD */}
            <div
                className="v2-glass"
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    display: "flex",
                    alignItems: "center",
                    gap: "14px",
                    padding: "12px 28px",
                    opacity: show ? 1 : 0,
                    pointerEvents: show ? "auto" : "none",
                    transition: "opacity 180ms ease",
                }}
            >
                <button className="v2-btn" onClick={onBack}>
                    <ArrowLeft size={18} />
                    Back
                </button>
                <div style={{ marginLeft: "8px" }}>
                    <div style={{ fontSize: "15px", fontWeight: 600, color: "var(--v2-text)" }}>{video.title}</div>
                    <div style={{ fontSize: "12px", color: "var(--v2-text-muted)" }}>{video.ep}</div>
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
                    <button className="v2-btn" onClick={() => setPip(true)}>
                        <PictureInPicture2 size={16} />
                    </button>
                    <button className="v2-btn" onClick={toggleFull}>
                        {full ? <Minimize size={16} /> : <Maximize size={16} />}
                    </button>
                </div>
            </div>

            {/* Bottom HUD */}
            <div
                style={{
                    position: "absolute",
                    bottom: 24,
                    left: "50%",
                    transform: "translateX(-50%)",
                    width: "min(960px, calc(100% - 48px))",
                    display: "flex",
                    flexDirection: "column",
                    gap: "10px",
                    padding: "14px 20px",
                    borderRadius: "var(--v2-radius-lg)",
                    opacity: show ? 1 : 0,
                    pointerEvents: show ? "auto" : "none",
                    transition: "opacity 180ms ease",
                }}
                className="v2-glass"
            >
                {/* Timeline Scrubber */}
                <div
                    onClick={(e) => setTime(timeFrom(e))}
                    style={{
                        position: "relative",
                        height: "8px",
                        backgroundColor: "rgba(255,255,255,0.15)",
                        borderRadius: "999px",
                        cursor: "pointer",
                    }}
                >
                    <div
                        style={{
                            height: "100%",
                            backgroundColor: "var(--v2-accent)",
                            borderRadius: "999px",
                            width: `${pct}%`,
                        }}
                    />
                </div>

                {/* Controls Row */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button className="v2-btn" onClick={() => setPlaying((p) => !p)}>
                            {playing ? (
                                <Pause size={18} fill="currentColor" />
                            ) : (
                                <Play size={18} fill="currentColor" />
                            )}
                        </button>
                        <button className="v2-btn" onClick={() => seek(-10)}>
                            <RotateCcw size={16} />
                        </button>
                        <button className="v2-btn" onClick={() => seek(10)}>
                            <RotateCw size={16} />
                        </button>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px", marginLeft: "8px" }}>
                            <button className="v2-btn" onClick={() => setMuted((m) => !m)}>
                                <VolIcon size={16} />
                            </button>
                            <input
                                type="range"
                                className="v2-slider"
                                min={0}
                                max={1}
                                step={0.05}
                                value={vol}
                                onChange={(e) => {
                                    setVolume(+e.target.value);
                                    setMuted(false);
                                }}
                                style={{ width: "80px" }}
                            />
                        </div>

                        <span
                            style={{
                                fontSize: "12px",
                                fontVariantNumeric: "tabular-nums",
                                marginLeft: "12px",
                                color: "var(--v2-text-muted)",
                            }}
                        >
                            {fmt(time)} / {fmt(video.dur)}
                        </span>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        {/* Speed Selector */}
                        <button
                            className="v2-btn"
                            data-active={speed !== 1}
                            onClick={() => setSpeed(speed === 1 ? 1.5 : speed === 1.5 ? 2 : 1)}
                        >
                            <Gauge size={15} />
                            {speed}x
                        </button>

                        {/* Subtitles Toggle */}
                        <button
                            className="v2-btn"
                            data-active={sub > 0}
                            onClick={() => setSub((s) => (s + 1) % SUBS.length)}
                        >
                            <Captions size={15} />
                            {SUBS[sub].split(" ")[0]}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
