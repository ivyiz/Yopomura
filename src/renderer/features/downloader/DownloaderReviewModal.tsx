import type { DownloaderReview, DownloaderState } from "@common/types/downloader";
import { faImage, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
    memo,
    type KeyboardEvent as ReactKeyboardEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { clearReviewImageCache, useReviewImage } from "./reviewImageCache";
import "./downloaderReview.scss";

type DownloaderReviewModalProps = {
    onOpenChange?: (open: boolean) => void;
};

type ReviewEntry = {
    url: string;
    /** Page URL used as the CDN referer. */
    referer?: string;
    /** Zero-based position in the original list; stays stable while filtering. */
    index: number;
    name: string;
    host: string;
    /** Lower-cased "url + name" computed once so filtering stays cheap on 200+ images. */
    haystack: string;
};

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

const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])';

type ReviewCardProps = {
    entry: ReviewEntry;
    checked: boolean;
    onToggle: (url: string) => void;
};

/**
 * One image card. The whole card is a <label>, so a click anywhere (or Space on the
 * focused checkbox) toggles the input exactly once: the label forwards the click to
 * the input and the input's own click never re-triggers the label.
 *
 * Memoised on purpose: toggling one image must not re-render the other 199.
 */
const ReviewCard = memo(({ entry, checked, onToggle }: ReviewCardProps) => {
    const { url, referer, index, name, host } = entry;
    const { hostRef, src } = useReviewImage(url, referer);
    return (
        <label className={`downloaderReviewItem${checked ? " is-selected" : ""}`}>
            <span ref={hostRef} className="downloaderReviewThumb">
                <input
                    type="checkbox"
                    className="downloaderReviewCheck"
                    checked={checked}
                    aria-label={`Select ${name}`}
                    onChange={() => onToggle(url)}
                    onKeyDown={(event) => {
                        // Space is native; Enter is not, so map it to the same toggle.
                        if (event.key === "Enter") {
                            event.preventDefault();
                            onToggle(url);
                        }
                    }}
                />
                <span className="downloaderReviewIndex" aria-hidden="true">
                    {String(index + 1).padStart(3, "0")}
                </span>
                <FontAwesomeIcon icon={faImage} className="downloaderReviewPlaceholder" aria-hidden="true" />
                {src ? <img src={src} alt="" decoding="async" draggable={false} /> : null}
            </span>
            <span className="downloaderReviewText">
                <span className="downloaderReviewName" title={name}>
                    {name}
                </span>
                <span className="downloaderReviewHost">{host}</span>
            </span>
        </label>
    );
});

/**
 * Full-window review shown after the resolver finds images. Every image starts
 * selected; the user unchecks the ones that should not be downloaded.
 */
const DownloaderReviewModal = ({ onOpenChange }: DownloaderReviewModalProps) => {
    const [jobId, setJobId] = useState<string | null>(null);
    const [review, setReview] = useState<DownloaderReview | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const jobIdRef = useRef<string | null>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const sync = (state: DownloaderState) => {
            const next = state.jobs.find((job) => job.status === "review") ?? null;
            const nextId = next?.id ?? null;
            if (nextId === jobIdRef.current) return;
            jobIdRef.current = nextId;
            setJobId(nextId);
            setReview(null);
            setMessage("");
            setQuery("");
            if (!nextId) clearReviewImageCache();
        };
        void window.electron.invoke("downloader:getState").then(sync);
        const unsubscribe = window.electron.on("downloader:state", sync);
        return () => {
            unsubscribe?.();
            clearReviewImageCache();
        };
    }, []);

    useEffect(() => {
        if (!jobId) return;
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

    // The App hides the native browser view while this is true; it must not close the tab.
    const open = Boolean(jobId && review);
    useEffect(() => {
        onOpenChange?.(open);
        return () => {
            if (open) onOpenChange?.(false);
        };
    }, [onOpenChange, open]);

    // Move focus into the dialog on open and give it back on close.
    useEffect(() => {
        if (!open) return;
        const previous = document.activeElement as HTMLElement | null;
        dialogRef.current?.focus();
        return () => previous?.focus?.();
    }, [open]);

    const entries = useMemo<ReviewEntry[]>(
        () =>
            (review?.items ?? []).map((item, index) => {
                const name = filenameOf(item.url);
                return {
                    url: item.url,
                    referer: item.referer,
                    index,
                    name,
                    host: hostOf(item.url),
                    haystack: `${item.url}\n${name}`.toLowerCase(),
                };
            }),
        [review],
    );

    const needle = query.trim().toLowerCase();
    const visible = useMemo(
        () => (needle ? entries.filter((entry) => entry.haystack.includes(needle)) : entries),
        [entries, needle],
    );

    const visibleSelectedCount = useMemo(
        () => visible.reduce((count, entry) => count + (selected.has(entry.url) ? 1 : 0), 0),
        [visible, selected],
    );

    const toggle = useCallback((url: string) => {
        setSelected((current) => {
            const next = new Set(current);
            if (next.has(url)) next.delete(url);
            else next.add(url);
            return next;
        });
    }, []);

    // With a filter active, Select All / Clear act on what is shown; without one, on everything.
    const selectAll = () =>
        setSelected((current) => {
            const next = new Set(current);
            for (const entry of visible) next.add(entry.url);
            return next;
        });

    const clearAll = () =>
        setSelected((current) => {
            const next = new Set(current);
            for (const entry of visible) next.delete(entry.url);
            return next;
        });

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

    // Keep Tab inside the dialog so keyboard users never land on the page behind it.
    const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key !== "Tab") return;
        const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!nodes || nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === dialogRef.current)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            first.focus();
        }
    };

    if (!jobId || !review) return null;

    const total = entries.length;
    const allVisibleSelected = visible.length > 0 && visibleSelectedCount === visible.length;

    return (
        <div className="downloaderReviewOverlay">
            <div
                ref={dialogRef}
                className="downloaderReview"
                role="dialog"
                aria-modal="true"
                aria-labelledby="downloaderReviewTitle"
                tabIndex={-1}
                onKeyDown={trapTab}
            >
                <header className="downloaderReviewHead">
                    <h2 id="downloaderReviewTitle">Review Images</h2>
                    <p className="downloaderReviewSubtitle" title={review.title || "Download"}>
                        {review.title || "Download"}
                    </p>
                    <span className="downloaderReviewTotal">{total === 1 ? "1 image" : `${total} images`}</span>
                    <button
                        type="button"
                        className="downloaderReviewClose"
                        aria-label="Cancel job and close"
                        title="Cancel job and close"
                        onClick={() => void cancel()}
                        disabled={busy}
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </header>

                <div className="downloaderReviewToolbar">
                    <input
                        type="text"
                        value={query}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                        placeholder="Filter by filename or link"
                        aria-label="Filter by filename or link"
                        spellCheck={false}
                    />
                    <button
                        type="button"
                        onClick={selectAll}
                        disabled={visible.length === 0 || allVisibleSelected}
                    >
                        Select All
                    </button>
                    <button type="button" onClick={clearAll} disabled={visibleSelectedCount === 0}>
                        Clear
                    </button>
                    <span className="downloaderReviewCount" aria-live="polite">
                        <strong>{selected.size}</strong> / {total} selected
                    </span>
                </div>

                <div className="downloaderReviewGrid">
                    {visible.length === 0 ? (
                        <p className="downloaderReviewEmpty">No images match this filter.</p>
                    ) : (
                        visible.map((entry) => (
                            <ReviewCard
                                key={entry.url}
                                entry={entry}
                                checked={selected.has(entry.url)}
                                onToggle={toggle}
                            />
                        ))
                    )}
                </div>

                <footer className="downloaderReviewActions">
                    {message ? (
                        <span className="downloaderReviewMessage" role="alert">
                            {message}
                        </span>
                    ) : null}
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
