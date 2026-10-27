import { faFilm } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { absolutePathToFileUrl } from "@utils/libraryCover";
import { useEffect, useRef, useState } from "react";

type MediaThumbnailProps = {
    path: string;
    className?: string;
};

/**
 * Small video frame used in the Up next list and Continue watching cards.
 * Only mounted while near the viewport, so a large library does not keep
 * hundreds of media elements alive. The element itself renders the frame (no
 * canvas), which avoids tainting for local file URLs.
 */
export const MediaThumbnail = ({ path, className = "" }: MediaThumbnailProps) => {
    const hostRef = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(false);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const element = hostRef.current;
        if (!element) return;
        if (typeof IntersectionObserver === "undefined") {
            setVisible(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                const next = entries.some((entry) => entry.isIntersecting);
                setVisible(next);
                if (!next) setReady(false);
            },
            { rootMargin: "240px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    return (
        <span ref={hostRef} className={`mediaPanelThumb ${className}`.trim()} aria-hidden>
            {visible && !failed ? (
                <video
                    className={`mediaPanelThumbVideo${ready ? " is-ready" : ""}`}
                    src={absolutePathToFileUrl(path)}
                    muted
                    playsInline
                    preload="metadata"
                    tabIndex={-1}
                    disablePictureInPicture
                    onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        if (Number.isFinite(video.duration) && video.duration > 0) {
                            try {
                                video.currentTime = Math.min(5, Math.max(0.1, video.duration * 0.1));
                            } catch {
                                /* seeking can fail before the first frame is ready */
                            }
                        }
                    }}
                    onLoadedData={() => setReady(true)}
                    onSeeked={() => setReady(true)}
                    onError={() => setFailed(true)}
                />
            ) : (
                <FontAwesomeIcon icon={faFilm} />
            )}
            {!ready && visible && !failed ? <span className="mediaPanelThumbShade" /> : null}
        </span>
    );
};

export default MediaThumbnail;
