import { useEffect, useRef, useState } from "react";

/**
 * Review thumbnail cache.
 *
 * Images are fetched through `downloader:getReviewImage`, which adds the page
 * `Referer` and reuses the browser session cookies. Blob URLs are cached in LRU
 * order so scrolling the review grid never re-downloads a frame.
 */

const MAX_CACHE_ENTRIES = 240;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

const keyOf = (url: string, referer?: string): string => `${url}\u0000${referer ?? ""}`;

const safeRevokeObjectURL = (url: string | null | undefined): void => {
    if (typeof url === "string" && url.startsWith("blob:")) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* revoking a stale blob url is best effort */
        }
    }
};

const remember = (key: string, objectUrl: string): void => {
    const previous = cache.get(key);
    if (previous) safeRevokeObjectURL(previous);
    cache.delete(key);
    cache.set(key, objectUrl);
    while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (!oldest) break;
        const value = cache.get(oldest);
        cache.delete(oldest);
        if (value) safeRevokeObjectURL(value);
    }
};

export const clearReviewImageCache = (): void => {
    for (const objectUrl of cache.values()) {
        safeRevokeObjectURL(objectUrl);
    }
    cache.clear();
    inflight.clear();
};

export const getCachedReviewImage = (url: string, referer?: string): string | null =>
    cache.get(keyOf(url, referer)) ?? null;

const downloadReviewImage = async (url: string, referer?: string): Promise<string | null> => {
    const result = await window.electron.invoke("downloader:getReviewImage", { url, referer });
    if (!result.ok) return null;
    const binary = atob(result.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    const blob = new Blob([bytes], { type: result.contentType || "image/jpeg" });
    return URL.createObjectURL(blob);
};

export const loadReviewImage = (url: string, referer?: string): Promise<string | null> => {
    const key = keyOf(url, referer);
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = inflight.get(key);
    if (pending) return pending;
    const request = downloadReviewImage(url, referer)
        .then((objectUrl) => {
            if (objectUrl) remember(key, objectUrl);
            return objectUrl;
        })
        .catch(() => null)
        .finally(() => {
            inflight.delete(key);
        });
    inflight.set(key, request);
    return request;
};

/**
 * Loads one review image once it is near the viewport. Returns the span ref the
 * observer attaches to plus the blob URL (or `failed` when the request failed).
 */
export const useReviewImage = (url: string, referer?: string) => {
    const hostRef = useRef<HTMLSpanElement>(null);
    const [src, setSrc] = useState<string | null>(() => getCachedReviewImage(url, referer));
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (src) return;
        let cancelled = false;
        const load = () => {
            void loadReviewImage(url, referer).then((objectUrl) => {
                if (cancelled) return;
                if (objectUrl) setSrc(objectUrl);
                else setFailed(true);
            });
        };
        const element = hostRef.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            load();
            return () => {
                cancelled = true;
            };
        }
        const observer = new IntersectionObserver(
            (records) => {
                if (!records.some((record) => record.isIntersecting)) return;
                observer.disconnect();
                load();
            },
            { rootMargin: "320px" },
        );
        observer.observe(element);
        return () => {
            cancelled = true;
            observer.disconnect();
        };
    }, [url, referer, src]);

    return { hostRef, src, failed };
};
