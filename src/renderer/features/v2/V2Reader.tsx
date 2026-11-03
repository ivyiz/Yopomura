import {
    ArrowLeft,
    ArrowRight,
    Bookmark,
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Home,
    Maximize,
    Minimize2,
    PanelRight,
    Search,
    Settings,
    SunMedium,
    ZoomIn,
    ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageArt from "./PageArt";
import "./v2Styles.scss";

type Layout = "single" | "double" | "strip";
type Fit = "width" | "height" | "screen" | "original";
type Dir = "ltr" | "rtl" | "vertical";

const TOTAL = 45;
const CHAPTERS = [
    "Ch. 40: Salt and Thunder",
    "Ch. 41: The Lantern Road",
    "Ch. 42: The Beginning",
    "Ch. 43: Hollow Tide",
    "Ch. 44: What the Wind Kept",
];

const SHORTCUTS: [string, string[]][] = [
    ["Next page", ["→", "Space"]],
    ["Previous page", ["←", "Shift + Space"]],
    ["Next chapter", ["]"]],
    ["Previous chapter", ["["]],
    ["Quick jump", ["Ctrl", "K"]],
    ["Toggle bookmark", ["B"]],
    ["Thumbnails drawer", ["T"]],
    ["Zen mode", ["F"]],
    ["Zoom in / out", ["+", "−"]],
    ["Reset zoom", ["0"]],
];

export default function V2Reader({ onBack }: { onBack?: () => void }) {
    const [layout, setLayout] = useState<Layout>("single");
    const [dir, setDir] = useState<Dir>("ltr");
    const [fit, setFit] = useState<Fit>("height");
    const [zoom, setZoom] = useState(1);
    const [page, setPage] = useState(18);
    const [chapter, setChapter] = useState(2);
    const [offset, setOffset] = useState(true);
    const [bookmarks, setBookmarks] = useState<number[]>([12]);
    const [drawer, setDrawer] = useState(false);
    const [settings, setSettings] = useState(false);
    const [tab, setTab] = useState<"display" | "memory" | "keys">("display");
    const [cache, setCache] = useState(50);
    const [zen, setZen] = useState(false);
    const [chapMenu, setChapMenu] = useState(false);
    const [invert, setInvert] = useState(false);
    const [hud, setHud] = useState(true);
    const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
    const idle = useRef<number>(0);

    useEffect(() => {
        const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener("resize", on);
        return () => window.removeEventListener("resize", on);
    }, []);

    const wake = useCallback(() => {
        setHud(true);
        window.clearTimeout(idle.current);
        idle.current = window.setTimeout(() => setHud(false), 3200);
    }, []);

    useEffect(() => {
        wake();
        window.addEventListener("mousemove", wake);
        window.addEventListener("keydown", wake);
        return () => {
            window.removeEventListener("mousemove", wake);
            window.clearTimeout(idle.current);
        };
    }, [wake]);

    const hudOn = hud || settings || chapMenu;

    const spreads = useMemo(() => {
        const out: number[][] = [];
        if (layout !== "double") {
            for (let i = 1; i <= TOTAL; i++) out.push([i]);
            return out;
        }
        let i = 1;
        if (offset) {
            out.push([1]);
            i = 2;
        }
        for (; i <= TOTAL; i += 2) out.push(i + 1 <= TOTAL ? [i, i + 1] : [i]);
        return out;
    }, [layout, offset]);

    const spreadIdx = Math.max(
        0,
        spreads.findIndex((s) => s.includes(page)),
    );

    const go = useCallback((p: number) => setPage(Math.min(TOTAL, Math.max(1, p))), []);
    const step = useCallback(
        (d: 1 | -1) => {
            const s = spreads[Math.min(spreads.length - 1, Math.max(0, spreadIdx + d))];
            if (s) go(s[0]);
        },
        [spreads, spreadIdx, go],
    );

    const chapStep = (d: number) => {
        setChapter((c) => Math.min(CHAPTERS.length - 1, Math.max(0, c + d)));
        setPage(1);
    };

    const toggleBookmark = () =>
        setBookmarks((b) => (b.includes(page) ? b.filter((x) => x !== page) : [...b, page]));

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSettings(false);
                setChapMenu(false);
                if (zen) setZen(false);
                return;
            }
            if ((e.target as HTMLElement).tagName === "INPUT") return;
            const k = e.key;
            if (k === "ArrowRight") step(dir === "rtl" && layout !== "strip" ? -1 : 1);
            else if (k === "ArrowLeft") step(dir === "rtl" && layout !== "strip" ? 1 : -1);
            else if (k === "b") toggleBookmark();
            else if (k === "t") setDrawer((d) => !d);
            else if (k === "f") setZen((z) => !z);
            else if (k === "+" || k === "=") setZoom((z) => Math.min(3, +(z + 0.1).toFixed(2)));
            else if (k === "-") setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)));
            else if (k === "0") setZoom(1);
            else if (k === "]") chapStep(1);
            else if (k === "[") chapStep(-1);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const cols = layout === "double" ? 2 : 1;
    const availH = size.h - 48;
    const base =
        fit === "original"
            ? 700
            : fit === "width"
              ? Math.min(size.w / cols - 40, 1100)
              : Math.min(availH * 0.7, (size.w / cols - 40) * 0.7);

    const activeSpread = spreads[spreadIdx] || [1];

    return (
        <div
            className="v2-container"
            style={{
                position: "relative",
                width: "100%",
                height: "100%",
                backgroundColor: "var(--v2-bg)",
                filter: invert ? "invert(0.92) hue-rotate(180deg)" : "none",
            }}
        >
            {/* Top Bar HUD */}
            {!zen && (
                <header
                    className="v2-glass"
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        right: 0,
                        zIndex: 30,
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "8px 24px",
                        opacity: hudOn ? 1 : 0,
                        pointerEvents: hudOn ? "auto" : "none",
                        transition: "opacity 180ms ease",
                    }}
                >
                    <button className="v2-btn" onClick={onBack}>
                        <Home size={16} />
                        Library
                    </button>
                    <div className="v2-sep" />

                    {/* Chapter Selector */}
                    <div style={{ position: "relative" }}>
                        <button className="v2-btn" onClick={() => setChapMenu((m) => !m)}>
                            <span>{CHAPTERS[chapter]}</span>
                            <ChevronDown size={14} />
                        </button>
                        {chapMenu && (
                            <div
                                className="v2-glass v2-pop"
                                style={{
                                    position: "absolute",
                                    top: "100%",
                                    left: 0,
                                    marginTop: "6px",
                                    width: "240px",
                                    borderRadius: "var(--v2-radius-md)",
                                    padding: "6px",
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "2px",
                                }}
                            >
                                {CHAPTERS.map((ch, idx) => (
                                    <button
                                        key={ch}
                                        className="v2-btn"
                                        data-active={idx === chapter}
                                        onClick={() => {
                                            setChapter(idx);
                                            setPage(1);
                                            setChapMenu(false);
                                        }}
                                        style={{ justifyContent: "flex-start", height: "32px" }}
                                    >
                                        {ch}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ display: "flex", gap: "4px" }}>
                        <button className="v2-btn" onClick={() => chapStep(-1)}>
                            <ChevronLeft size={16} />
                        </button>
                        <button className="v2-btn" onClick={() => chapStep(1)}>
                            <ChevronRight size={16} />
                        </button>
                    </div>

                    <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
                        <button className="v2-btn" data-active={bookmarks.includes(page)} onClick={toggleBookmark}>
                            <Bookmark size={16} fill={bookmarks.includes(page) ? "currentColor" : "none"} />
                        </button>
                        <button className="v2-btn" onClick={() => setZen((z) => !z)}>
                            <Maximize size={16} />
                        </button>
                        <button className="v2-btn" onClick={() => setDrawer((d) => !d)}>
                            <PanelRight size={16} />
                        </button>
                        <button className="v2-btn" onClick={() => setSettings((s) => !s)}>
                            <Settings size={16} />
                        </button>
                    </div>
                </header>
            )}

            {/* Main Canvas */}
            <main
                style={{
                    flex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: layout === "strip" ? "auto" : "hidden",
                    padding: zen ? "12px" : "48px 12px 64px",
                }}
            >
                {layout === "strip" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "center" }}>
                        {Array.from({ length: TOTAL }, (_, i) => i + 1).map((n) => (
                            <div
                                key={n}
                                style={{
                                    width: `${base * zoom}px`,
                                    borderRadius: "var(--v2-radius-sm)",
                                    overflow: "hidden",
                                    border: "1px solid var(--v2-border)",
                                }}
                            >
                                <PageArt n={n} />
                            </div>
                        ))}
                    </div>
                ) : (
                    <div
                        style={{
                            display: "flex",
                            gap: "8px",
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: dir === "rtl" ? "row-reverse" : "row",
                        }}
                    >
                        {activeSpread.map((n) => (
                            <div
                                key={n}
                                style={{
                                    width: `${base * zoom}px`,
                                    borderRadius: "var(--v2-radius-sm)",
                                    overflow: "hidden",
                                    border: "1px solid var(--v2-border)",
                                }}
                            >
                                <PageArt n={n} />
                            </div>
                        ))}
                    </div>
                )}
            </main>

            {/* Floating Bottom Toolbar HUD */}
            {!zen && (
                <div
                    className="v2-glass"
                    style={{
                        position: "absolute",
                        bottom: 16,
                        left: "50%",
                        transform: "translateX(-50%)",
                        zIndex: 30,
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "8px 18px",
                        borderRadius: "var(--v2-radius-lg)",
                        opacity: hudOn ? 1 : 0,
                        pointerEvents: hudOn ? "auto" : "none",
                        transition: "opacity 180ms ease",
                    }}
                >
                    {/* Layout Buttons */}
                    <div style={{ display: "flex", gap: "4px" }}>
                        <button
                            className="v2-btn"
                            data-active={layout === "single"}
                            onClick={() => setLayout("single")}
                        >
                            Single
                        </button>
                        <button
                            className="v2-btn"
                            data-active={layout === "double"}
                            onClick={() => setLayout("double")}
                        >
                            Double
                        </button>
                        <button
                            className="v2-btn"
                            data-active={layout === "strip"}
                            onClick={() => setLayout("strip")}
                        >
                            Strip
                        </button>
                    </div>

                    <div className="v2-sep" />

                    {/* Navigation Controls */}
                    <button className="v2-btn" onClick={() => step(-1)}>
                        <ArrowLeft size={16} />
                    </button>
                    <span
                        style={{ fontSize: "13px", fontVariantNumeric: "tabular-nums", color: "var(--v2-text)" }}
                    >
                        Page {page} / {TOTAL}
                    </span>
                    <button className="v2-btn" onClick={() => step(1)}>
                        <ArrowRight size={16} />
                    </button>

                    <div className="v2-sep" />

                    {/* Zoom & Adjustments */}
                    <button
                        className="v2-btn"
                        onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.1).toFixed(2)))}
                    >
                        <ZoomOut size={16} />
                    </button>
                    <span
                        style={{
                            fontSize: "12px",
                            fontVariantNumeric: "tabular-nums",
                            color: "var(--v2-text-muted)",
                        }}
                    >
                        {Math.round(zoom * 100)}%
                    </span>
                    <button
                        className="v2-btn"
                        onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))}
                    >
                        <ZoomIn size={16} />
                    </button>

                    <div className="v2-sep" />

                    <button className="v2-btn" data-active={invert} onClick={() => setInvert((v) => !v)}>
                        <SunMedium size={16} />
                    </button>
                </div>
            )}

            {/* Right Drawer: Thumbnails */}
            {drawer && (
                <aside
                    className="v2-glass v2-pop"
                    style={{
                        position: "absolute",
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: "320px",
                        zIndex: 40,
                        borderLeft: "1px solid var(--v2-border)",
                        display: "flex",
                        flexDirection: "column",
                        padding: "16px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: "16px",
                        }}
                    >
                        <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Pages ({TOTAL})</h3>
                        <button className="v2-btn" onClick={() => setDrawer(false)}>
                            Close
                        </button>
                    </div>
                    <div
                        style={{
                            flex: 1,
                            overflowY: "auto",
                            display: "grid",
                            gridTemplateColumns: "repeat(2, 1fr)",
                            gap: "10px",
                        }}
                    >
                        {Array.from({ length: TOTAL }, (_, i) => i + 1).map((n) => (
                            <div
                                key={n}
                                onClick={() => {
                                    go(n);
                                    setDrawer(false);
                                }}
                                style={{
                                    border:
                                        page === n ? "2px solid var(--v2-accent)" : "1px solid var(--v2-border)",
                                    borderRadius: "var(--v2-radius-sm)",
                                    cursor: "pointer",
                                    overflow: "hidden",
                                }}
                            >
                                <div style={{ height: "140px" }}>
                                    <PageArt n={n} />
                                </div>
                                <div
                                    style={{
                                        textAlign: "center",
                                        padding: "4px",
                                        fontSize: "11px",
                                        color: "var(--v2-text-muted)",
                                    }}
                                >
                                    {n}
                                </div>
                            </div>
                        ))}
                    </div>
                </aside>
            )}

            {/* Settings Modal */}
            {settings && (
                <div
                    className="v2-glass v2-pop"
                    style={{
                        position: "absolute",
                        top: "64px",
                        right: "24px",
                        width: "360px",
                        zIndex: 50,
                        borderRadius: "var(--v2-radius-lg)",
                        padding: "20px",
                    }}
                >
                    <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
                        {(["display", "memory", "keys"] as const).map((t) => (
                            <button
                                key={t}
                                className="v2-btn"
                                data-active={tab === t}
                                onClick={() => setTab(t)}
                                style={{ flex: 1, textTransform: "capitalize" }}
                            >
                                {t}
                            </button>
                        ))}
                    </div>

                    {tab === "display" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                            <div>
                                <div
                                    style={{
                                        display: "block",
                                        marginBottom: "6px",
                                        color: "var(--v2-text-muted)",
                                    }}
                                >
                                    Page Fit
                                </div>
                                <div style={{ display: "flex", gap: "4px" }}>
                                    {(["width", "height", "screen", "original"] as const).map((f) => (
                                        <button
                                            key={f}
                                            className="v2-btn"
                                            data-active={fit === f}
                                            onClick={() => setFit(f)}
                                            style={{ flex: 1, fontSize: "11px" }}
                                        >
                                            {f}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <div
                                    style={{
                                        display: "block",
                                        marginBottom: "6px",
                                        color: "var(--v2-text-muted)",
                                    }}
                                >
                                    Reading Direction
                                </div>
                                <div style={{ display: "flex", gap: "4px" }}>
                                    {(["ltr", "rtl"] as const).map((d) => (
                                        <button
                                            key={d}
                                            className="v2-btn"
                                            data-active={dir === d}
                                            onClick={() => setDir(d)}
                                            style={{ flex: 1, textTransform: "uppercase" }}
                                        >
                                            {d}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    )}

                    {tab === "memory" && (
                        <div style={{ display: "flex", flexDirection: "column", gap: "14px", fontSize: "13px" }}>
                            <div>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        marginBottom: "8px",
                                    }}
                                >
                                    <div style={{ color: "var(--v2-text-muted)" }}>LRU Image Cache Limit</div>
                                    <span style={{ fontWeight: 600, color: "var(--v2-accent)" }}>
                                        {cache} pages
                                    </span>
                                </div>
                                <input
                                    type="range"
                                    className="v2-slider"
                                    min={20}
                                    max={200}
                                    step={5}
                                    value={cache}
                                    onChange={(e) => setCache(+e.target.value)}
                                    style={{ width: "100%" }}
                                />
                                <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--v2-text-muted)" }}>
                                    Evicts older pages from RAM while reading smoothly.
                                </p>
                            </div>
                        </div>
                    )}

                    {tab === "keys" && (
                        <div
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                                maxHeight: "240px",
                                overflowY: "auto",
                            }}
                        >
                            {SHORTCUTS.map(([label, keys]) => (
                                <div
                                    key={label}
                                    style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        fontSize: "12px",
                                    }}
                                >
                                    <span style={{ color: "var(--v2-text-muted)" }}>{label}</span>
                                    <div style={{ display: "flex", gap: "4px" }}>
                                        {keys.map((k) => (
                                            <span key={k} className="v2-kbd">
                                                {k}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
