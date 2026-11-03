import { useState } from "react";
import { VIDEOS } from "./data";
import V2Library from "./V2Library";
import V2Player from "./V2Player";
import V2Reader from "./V2Reader";
import "./v2Styles.scss";

export type V2ViewMode = "library" | "player" | "reader";

export default function V2App({ onOpenSettings }: { onOpenSettings?: () => void }) {
    const [view, setView] = useState<V2ViewMode>("library");
    const [selectedVideoId, setSelectedVideoId] = useState<number | null>(null);

    const selectedVideo = VIDEOS.find((v) => v.id === selectedVideoId);

    const handlePlayVideo = (id: number) => {
        setSelectedVideoId(id);
        setView("player");
    };

    const handleOpenReader = () => {
        setView("reader");
    };

    const handleBackToLibrary = () => {
        setSelectedVideoId(null);
        setView("library");
    };

    return (
        <div className="v2-container" style={{ width: "100vw", height: "100vh", position: "relative" }}>
            {view === "library" && (
                <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column" }}>
                    {/* Sub-header toggle to test V2 Manga Reader */}
                    <div
                        style={{
                            position: "absolute",
                            top: "16px",
                            right: "480px",
                            zIndex: 35,
                            display: "flex",
                            gap: "6px",
                        }}
                    >
                        <button
                            className="v2-btn"
                            onClick={handleOpenReader}
                            style={{
                                borderRadius: "var(--v2-radius-md)",
                                border: "1px solid var(--v2-border)",
                                backgroundColor: "color-mix(in srgb, var(--v2-bg) 80%, transparent)",
                                fontSize: "12px",
                            }}
                        >
                            Open V2 Reader
                        </button>
                    </div>
                    <V2Library onPlay={handlePlayVideo} onOpenSettings={onOpenSettings} />
                </div>
            )}

            {view === "player" && selectedVideo && <V2Player video={selectedVideo} onBack={handleBackToLibrary} />}

            {view === "reader" && <V2Reader onBack={handleBackToLibrary} />}
        </div>
    );
}
