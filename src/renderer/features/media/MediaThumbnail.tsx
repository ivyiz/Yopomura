import { faFilm } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { absolutePathToFileUrl } from "@utils/libraryCover";
import { useEffect, useRef, useState } from "react";
import {
    isThumbnailCached,
    releaseThumbnail,
    retainThumbnail,
    setThumbnailVisible,
    subscribeThumbnail,
} from "./thumbnailBudget";

let nextThumbnailId = 0;

type MediaThumbnailProps = {
    path: string;
    className?: string;
};

/**
 * Small video frame used in the Up next list, Continue Playing cards and Media Home.
 *
 * The `<video>` element is created on first intersection and then **kept mounted**
 * while the component lives, so scrolling the playlist up and down never reloads
 * the metadata or seeks the poster frame again. A shared LRU budget
 * (`thumbnailBudget.ts`) caps how many thumbnails stay alive at once.
 */
export const MediaThumbnail = ({ path, className = "" }: MediaThumbnailProps) => {
    const hostRef = useRef<HTMLSpanElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const instanceIdRef = useRef<number | null>(null);
    if (instanceIdRef.current === null) {
        nextThumbnailId += 1;
        instanceIdRef.current = nextThumbnailId;
    }
    const instanceId = `thumb-${instanceIdRef.current}`;
    const lastPathRef = useRef(path);
    const [activated, setActivated] = useState(false);
    const [cached, setCached] = useState(false);
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (lastPathRef.current !== path) {
            lastPathRef.current = path;
            setReady(false);
            setFailed(false);
        }
    }, [path]);

    const showVideo = activated && cached && !failed;

    useEffect(() => {
        return () => {
            if (videoRef.current) {
                videoRef.current.removeAttribute("src");
                videoRef.current.load();
            }
        };
    }, []);

    useEffect(() => subscribeThumbnail(instanceId, () => setCached(isThumbnailCached(instanceId))), [instanceId]);

    useEffect(() => () => releaseThumbnail(instanceId), [instanceId]);

    useEffect(() => {
        const element = hostRef.current;
        if (!element) return;
        if (typeof IntersectionObserver === "undefined") {
            setActivated(true);
            retainThumbnail(instanceId);
            setCached(true);
            return;
        }
        const observer = new IntersectionObserver(
            (records) => {
                const next = records.some((record) => record.isIntersecting);
                if (next) {
                    setActivated(true);
                    retainThumbnail(instanceId);
                    setCached(isThumbnailCached(instanceId));
                } else {
                    setThumbnailVisible(instanceId, false);
                }
            },
            { rootMargin: "240px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [instanceId]);

    return (
        <span ref={hostRef} className={`mediaPanelThumb ${className}`.trim()} aria-hidden>
            {showVideo ? (
                <video
                    ref={videoRef}
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
            {showVideo && !ready ? <span className="mediaPanelThumbShade" /> : null}
        </span>
    );
};

export default MediaThumbnail;
