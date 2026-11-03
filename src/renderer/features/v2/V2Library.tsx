import {
    ArrowDownUp,
    ChevronLeft,
    ChevronRight,
    Clock,
    Film,
    FolderOpen,
    Play,
    Plus,
    Search,
    Settings,
    Star,
} from "lucide-react";
import { useRef, useState } from "react";
import { fmt, VIDEOS, type Video } from "./data";
import Frame from "./Frame";
import "./v2Styles.scss";

const FILTERS = ["All", "Series", "Movies", "4K", "Recently added"] as const;

function ResTag({ res }: { res: Video["res"] }) {
    const is4K = res === "4K";
    return (
        <span
            style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "2px 6px",
                borderRadius: "var(--v2-radius-sm)",
                border: "1px solid var(--v2-border)",
                fontSize: "11px",
                fontWeight: 600,
                backgroundColor: "color-mix(in srgb, var(--v2-bg) 80%, transparent)",
                color: is4K ? "var(--v2-accent)" : "var(--v2-text)",
            }}
        >
            {res}
        </span>
    );
}

function PlayButton({ size }: { size: number }) {
    return (
        <span
            className="v2-btn"
            style={{
                width: size,
                height: size,
                borderRadius: "50%",
                backgroundColor: "color-mix(in srgb, var(--v2-bg) 60%, transparent)",
                border: "1px solid var(--v2-border-strong)",
                color: "var(--v2-text)",
                backdropFilter: "blur(16px)",
                padding: 0,
            }}
        >
            <Play size={size * 0.38} fill="currentColor" style={{ marginLeft: "4%" }} />
        </span>
    );
}

export default function V2Library({
    onPlay,
    onOpenSettings,
}: {
    onPlay: (id: number) => void;
    onOpenSettings?: () => void;
}) {
    const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
    const [q, setQ] = useState("");
    const rail = useRef<HTMLDivElement>(null);
    const continuing = VIDEOS.filter((v) => v.progress > 0);

    const list = VIDEOS.filter((v) => {
        if (q && !(v.title + v.ep).toLowerCase().includes(q.toLowerCase())) return false;
        if (filter === "Series") return v.ep.startsWith("S");
        if (filter === "Movies") return !v.ep.startsWith("S");
        if (filter === "4K") return v.res === "4K";
        if (filter === "Recently added") return v.id % 2 === 0;
        return true;
    });

    const scroll = (d: number) => rail.current?.scrollBy({ left: d * 820, behavior: "smooth" });

    return (
        <div className="v2-container" style={{ display: "flex", height: "100%", width: "100%" }}>
            {/* Sidebar */}
            <aside
                style={{
                    width: "80px",
                    flexShrink: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "8px",
                    borderRight: "1px solid var(--v2-border)",
                    padding: "24px 0",
                    backgroundColor: "color-mix(in srgb, var(--v2-bg) 95%, transparent)",
                }}
            >
                <div
                    style={{
                        marginBottom: "20px",
                        width: "40px",
                        height: "40px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        borderRadius: "var(--v2-radius-md)",
                        backgroundColor: "var(--v2-accent)",
                        color: "var(--v2-bg)",
                    }}
                >
                    <Play size={18} fill="currentColor" />
                </div>
                {[
                    [Film, "Library", true],
                    [Clock, "Recent", false],
                    [Star, "Favorites", false],
                    [FolderOpen, "Folders", false],
                ].map(([IconComponent, label, isActive]: any) => (
                    <button
                        key={label}
                        className="v2-btn"
                        data-active={!!isActive}
                        style={{
                            width: "56px",
                            height: "56px",
                            flexDirection: "column",
                            gap: "4px",
                            fontSize: "11px",
                        }}
                    >
                        <IconComponent size={20} />
                        {label}
                    </button>
                ))}
                <button
                    className="v2-btn"
                    onClick={onOpenSettings}
                    style={{
                        marginTop: "auto",
                        width: "56px",
                        height: "56px",
                        flexDirection: "column",
                        gap: "4px",
                        fontSize: "11px",
                    }}
                >
                    <Settings size={20} />
                    Settings
                </button>
            </aside>

            {/* Main Content Area */}
            <main style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
                {/* Sticky Header */}
                <header
                    className="v2-glass"
                    style={{
                        position: "sticky",
                        top: 0,
                        zIndex: 20,
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                        padding: "16px 36px",
                    }}
                >
                    <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>Library</h1>
                    <div style={{ marginLeft: "16px", display: "flex", gap: "6px" }}>
                        {FILTERS.map((f) => (
                            <button
                                key={f}
                                onClick={() => setFilter(f)}
                                className="v2-btn"
                                data-active={filter === f}
                                style={{
                                    height: "32px",
                                    borderRadius: "999px",
                                    padding: "0 14px",
                                    border: "1px solid var(--v2-border)",
                                }}
                            >
                                {f}
                            </button>
                        ))}
                    </div>

                    <div
                        style={{
                            marginLeft: "auto",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            width: "320px",
                            height: "36px",
                            padding: "0 12px",
                            borderRadius: "var(--v2-radius-md)",
                            border: "1px solid var(--v2-border)",
                            backgroundColor: "var(--v2-input-bg)",
                        }}
                    >
                        <Search size={15} style={{ color: "var(--v2-text-muted)" }} />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search library..."
                            style={{
                                flex: 1,
                                background: "transparent",
                                border: "none",
                                outline: "none",
                                fontSize: "13px",
                                color: "var(--v2-text)",
                            }}
                        />
                    </div>

                    <button
                        className="v2-btn"
                        style={{
                            height: "36px",
                            padding: "0 14px",
                            border: "1px solid var(--v2-border)",
                            backgroundColor: "var(--v2-btn)",
                        }}
                    >
                        <Plus size={16} />
                        Add folder
                    </button>
                </header>

                {/* Continue Watching Row */}
                {!q && filter === "All" && (
                    <section style={{ padding: "16px 36px 8px" }}>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "flex-end",
                                justifyContent: "space-between",
                                marginBottom: "14px",
                            }}
                        >
                            <div>
                                <h2 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 600 }}>
                                    Continue Watching
                                </h2>
                                <p style={{ margin: "4px 0 0", fontSize: "13px", color: "var(--v2-text-muted)" }}>
                                    Pick up right where you left off
                                </p>
                            </div>
                            <div style={{ display: "flex", gap: "8px" }}>
                                <button
                                    onClick={() => scroll(-1)}
                                    className="v2-btn"
                                    style={{
                                        width: "36px",
                                        height: "36px",
                                        borderRadius: "50%",
                                        border: "1px solid var(--v2-border)",
                                    }}
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <button
                                    onClick={() => scroll(1)}
                                    className="v2-btn"
                                    style={{
                                        width: "36px",
                                        height: "36px",
                                        borderRadius: "50%",
                                        border: "1px solid var(--v2-border)",
                                    }}
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        </div>

                        <div
                            ref={rail}
                            style={{
                                display: "flex",
                                gap: "20px",
                                overflowX: "auto",
                                scrollSnapType: "x mandatory",
                                paddingBottom: "8px",
                            }}
                        >
                            {continuing.map((v) => (
                                <div
                                    key={v.id}
                                    onClick={() => onPlay(v.id)}
                                    style={{
                                        position: "relative",
                                        aspectRatio: "16/9",
                                        width: "640px",
                                        flexShrink: 0,
                                        scrollSnapAlign: "start",
                                        overflow: "hidden",
                                        borderRadius: "var(--v2-radius-lg)",
                                        border: "1px solid var(--v2-border)",
                                        cursor: "pointer",
                                        textAlign: "left",
                                    }}
                                >
                                    <div style={{ position: "absolute", inset: 0 }}>
                                        <Frame seed={v.id} h1={v.h1} h2={v.h2} />
                                    </div>
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            background:
                                                "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.2) 60%, transparent 100%)",
                                        }}
                                    />
                                    <div style={{ position: "absolute", left: 16, top: 16 }}>
                                        <ResTag res={v.res} />
                                    </div>
                                    <div
                                        style={{
                                            position: "absolute",
                                            inset: 0,
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "center",
                                        }}
                                    >
                                        <PlayButton size={72} />
                                    </div>
                                    <div style={{ position: "absolute", left: 20, right: 20, bottom: 16 }}>
                                        <div
                                            style={{
                                                fontSize: "11px",
                                                fontWeight: 600,
                                                textTransform: "uppercase",
                                                color: "var(--v2-accent)",
                                            }}
                                        >
                                            Resume
                                        </div>
                                        <div style={{ fontSize: "1.4rem", fontWeight: 600, marginTop: "2px" }}>
                                            {v.title}
                                        </div>
                                        <div
                                            style={{
                                                fontSize: "13px",
                                                color: "rgba(255,255,255,0.7)",
                                                marginTop: "2px",
                                            }}
                                        >
                                            {v.ep}
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "12px",
                                                marginTop: "10px",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    flex: 1,
                                                    height: "4px",
                                                    borderRadius: "999px",
                                                    backgroundColor: "rgba(255,255,255,0.2)",
                                                    overflow: "hidden",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        height: "100%",
                                                        backgroundColor: "var(--v2-accent)",
                                                        width: `${(v.progress / v.dur) * 100}%`,
                                                    }}
                                                />
                                            </div>
                                            <span
                                                style={{
                                                    fontSize: "12px",
                                                    fontVariantNumeric: "tabular-nums",
                                                    color: "rgba(255,255,255,0.8)",
                                                }}
                                            >
                                                {fmt(v.progress)} / {fmt(v.dur)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Video Grid */}
                <section style={{ padding: "24px 36px 64px" }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            marginBottom: "16px",
                        }}
                    >
                        <h2 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600 }}>
                            {filter === "All" ? "All Items" : filter}{" "}
                            <span
                                style={{
                                    marginLeft: "8px",
                                    fontSize: "13px",
                                    fontWeight: 400,
                                    color: "var(--v2-text-muted)",
                                }}
                            >
                                {list.length} items
                            </span>
                        </h2>
                        <button className="v2-btn" style={{ gap: "6px" }}>
                            <ArrowDownUp size={14} />
                            Date added
                        </button>
                    </div>

                    <div
                        style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                            gap: "20px",
                        }}
                    >
                        {list.map((v) => (
                            <div
                                key={v.id}
                                onClick={() => onPlay(v.id)}
                                style={{
                                    cursor: "pointer",
                                    textAlign: "left",
                                }}
                            >
                                <div
                                    style={{
                                        position: "relative",
                                        aspectRatio: "16/9",
                                        overflow: "hidden",
                                        borderRadius: "var(--v2-radius-md)",
                                        border: "1px solid var(--v2-border)",
                                    }}
                                >
                                    <div style={{ position: "absolute", inset: 0 }}>
                                        <Frame seed={v.id} h1={v.h1} h2={v.h2} />
                                    </div>
                                    <div style={{ position: "absolute", left: 10, top: 10 }}>
                                        <ResTag res={v.res} />
                                    </div>
                                    <span
                                        style={{
                                            position: "absolute",
                                            right: 10,
                                            bottom: 10,
                                            padding: "2px 6px",
                                            borderRadius: "var(--v2-radius-sm)",
                                            backgroundColor: "rgba(0,0,0,0.65)",
                                            fontSize: "11px",
                                            fontVariantNumeric: "tabular-nums",
                                            color: "#fff",
                                        }}
                                    >
                                        {fmt(v.dur)}
                                    </span>
                                    {v.progress > 0 && (
                                        <div
                                            style={{
                                                position: "absolute",
                                                left: 0,
                                                right: 0,
                                                bottom: 0,
                                                height: "3px",
                                                backgroundColor: "rgba(255,255,255,0.2)",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    height: "100%",
                                                    backgroundColor: "var(--v2-accent)",
                                                    width: `${(v.progress / v.dur) * 100}%`,
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>

                                <div style={{ marginTop: "10px" }}>
                                    <div
                                        style={{
                                            fontSize: "14px",
                                            fontWeight: 500,
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {v.title}
                                    </div>
                                    <div
                                        style={{
                                            fontSize: "12px",
                                            color: "var(--v2-text-muted)",
                                            marginTop: "2px",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                            whiteSpace: "nowrap",
                                        }}
                                    >
                                        {v.ep}
                                    </div>
                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            fontSize: "11px",
                                            color: "var(--v2-text-muted)",
                                            marginTop: "4px",
                                        }}
                                    >
                                        <span
                                            style={{
                                                border: "1px solid var(--v2-border)",
                                                padding: "1px 4px",
                                                borderRadius: "4px",
                                            }}
                                        >
                                            {v.format}
                                        </span>
                                        <span>{v.size}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>
            </main>
        </div>
    );
}
