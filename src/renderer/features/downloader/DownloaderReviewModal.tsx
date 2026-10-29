import type { DownloaderReview, DownloaderState } from "@common/types/downloader";
import { closeBrowser } from "@features/browser/browserEvents";
import { faImage, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./downloaderReview.scss";

const filenameOf = (url: string): string => {
    try {
        const parsed = new URL(url);
        return decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
    } catch {
        return url;
    }
};

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
};

/**
 * Full-screen review shown after the resolver finds images. Every image starts
 * selected; the user unchecks the ones that should not be downloaded.
 */
const DownloaderReviewModal = () => {
    const [jobId, setJobId] = useState<string | null>(null);
    const [review, setReview] = useState<DownloaderReview | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const jobIdRef = useRef<string | null>(null);

    useEffect(() => {
        const sync = (state: DownloaderState) => {
            const next = state.jobs.find((job) => job.status === "review") ?? null;
            const nextId = next?.id ?? null;
            if (nextId === jobIdRef.current) return;
            jobIdRef.current = nextId;
            setJobId(nextId);
            setReview(null);
            setMessage("");
        };
        void window.electron.invoke("downloader:getState").then(sync);
        return window.electron.on("downloader:state", sync);
    }, []);

    useEffect(() => {
        if (!jobId) return;
        closeBrowser();
        let cancelled = false;
        void window.electron.invoke("downloader:getReview", { id: jobId }).then((result) => {
            if (cancelled) return;
            setReview(result);
            setSelected(new Set(result?.items.map((item) => item.url) ?? []));
        });
        return () => {
            cancelled = true;
        };
    }, [jobId]);

    const items = review?.items ?? [];
    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        return items
            .map((item, index) => ({ item, index }))
            .filter(
                ({ item }) =>
                    !needle ||
                    item.url.toLowerCase().includes(needle) ||
                    filenameOf(item.url).toLowerCase().includes(needle),
            );
    }, [items, query]);

    const toggle = useCallback((url: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(url)) next.delete(url);
            else next.add(url);
            return next;
        });
    }, []);

    const confirm = async () => {
        if (!jobId || busy) return;
        if (selected.size === 0) {
            setMessage("Select at least one image");
            return;
        }
        setBusy(true);
        setMessage("");
        try {
            const result = await window.electron.invoke("downloader:confirmReview", {
                id: jobId,
                urls: [...selected],
            });
            if (result.ok) {
                setReview(null);
            } else {
                setMessage(result.message);
            }
        } finally {
            setBusy(false);
        }
    };

    const cancel = async () => {
        if (!jobId || busy) return;
        setBusy(true);
        try {
            await window.electron.invoke("downloader:cancel", { id: jobId });
            setReview(null);
        } finally {
            setBusy(false);
        }
    };

    if (!jobId || !review) return null;

    return (
        <div className="downloaderReviewOverlay" role="dialog" aria-modal="true" aria-label="Review images">
            <div className="downloaderReview">
                <header className="downloaderReviewHead">
                    <div>
                        <h2>Review Images</h2>
                        <p>{review.title || "Download"}</p>
                    </div>
                    <div className="downloaderReviewCount">
                        <strong>{selected.size}</strong>
                        <span> / {items.length} selected</span>
                    </div>
                    <button type="button" className="downloaderReviewClose" onClick={() => void cancel()}>
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </header>

                <div className="downloaderReviewToolbar">
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                        placeholder="Filter by filename or URL"
                        spellCheck={false}
                    />
                    <button type="button" onClick={() => setSelected(new Set(items.map((item) => item.url)))}>
                        Select All
                    </button>
                    <button type="button" onClick={() => setSelected(new Set())}>
                        Clear
                    </button>
                    <span className="downloaderReviewHint">
                        Uncheck images you do not want, then download the selection.
                    </span>
                </div>

                <div className="downloaderReviewGrid">
                    {visible.length === 0 ? (
                        <p className="downloaderReviewEmpty">No images match this filter.</p>
                    ) : (
                        visible.map(({ item, index }) => {
                            const checked = selected.has(item.url);
                            return (
                                <label
                                    className={`downloaderReviewItem${checked ? " is-selected" : ""}`}
                                    key={item.url}
                                >
                                    <input type="checkbox" checked={checked} onChange={() => toggle(item.url)} />
                                    <span className="downloaderReviewThumb">
                                        <FontAwesomeIcon icon={faImage} />
                                        <img
                                            src={item.url}
                                            alt=""
                                            loading="lazy"
                                            referrerPolicy="no-referrer"
                                            draggable={false}
                                            onError={(event) => {
                                                event.currentTarget.style.display = "none";
                                            }}
                                        />
                                    </span>
                                    <span className="downloaderReviewText">
                                        <span className="downloaderReviewIndex">
                                            {String(index + 1).padStart(3, "0")}
                                        </span>
                                        <span className="downloaderReviewName">{filenameOf(item.url)}</span>
                                        <span className="downloaderReviewHost">{hostOf(item.url)}</span>
                                    </span>
                                </label>
                            );
                        })
                    )}
                </div>

                <footer className="downloaderReviewActions">
                    {message ? <span className="downloaderReviewMessage">{message}</span> : null}
                    <button type="button" onClick={() => void cancel()} disabled={busy}>
                        Cancel Job
                    </button>
                    <button
                        type="button"
                        className="downloaderReviewConfirm"
                        onClick={() => void confirm()}
                        disabled={busy || selected.size === 0}
                    >
                        {busy ? "Starting…" : `Download Selected (${selected.size})`}
                    </button>
                </footer>
            </div>
        </div>
    );
};

export default DownloaderReviewModal;
