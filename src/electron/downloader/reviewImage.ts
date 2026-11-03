import { getProxyUrlForRequests } from "@electron/network/proxySettings";

/** Image proxy for the downloader review grid. */
export type ReviewImageResult = { ok: true; data: string; contentType: string } | { ok: false; message: string };

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 20 * 1024 * 1024;

type Dispatcher = import("undici").Dispatcher;
let dispatcherPromise: Promise<Dispatcher> | null = null;

/**
 * Chromium rejects a manually set `Referer` header (`ERR_BLOCKED_BY_CLIENT`) and
 * `net.fetch` cannot attach cookies/referrer reliably, so CDN thumbnails are
 * fetched with undici instead. IPv4 is forced because some image CDNs resolve to
 * an unreachable IPv6 first and the request would otherwise time out.
 */
const getDispatcher = (): Promise<Dispatcher> => {
    if (!dispatcherPromise) {
        dispatcherPromise = import("undici").then(({ Agent, ProxyAgent }) => {
            const proxyUrl = getProxyUrlForRequests();
            return proxyUrl ? new ProxyAgent(proxyUrl) : new Agent({ connect: { family: 4 } });
        });
    }
    return dispatcherPromise;
};

/**
 * Fetches one review thumbnail with the page `Referer`, browser-like UA and the
 * configured proxy. This is what lets manga CDNs load thumbnails that a plain
 * `<img src>` cannot.
 */
export const fetchReviewImage = async (url: string, referer?: string): Promise<ReviewImageResult> => {
    let target: URL;
    try {
        target = new URL(url);
    } catch {
        return { ok: false, message: "Invalid image URL" };
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
        return { ok: false, message: "Unsupported image URL" };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
        const { fetch } = await import("undici");
        const response = await fetch(target.href, {
            headers: {
                "User-Agent": USER_AGENT,
                Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                Referer: referer?.trim() || `${target.origin}/`,
            },
            signal: controller.signal,
            dispatcher: await getDispatcher(),
        });
        if (!response.ok) {
            return { ok: false, message: `HTTP ${response.status}` };
        }
        const contentType = (response.headers.get("content-type") || "").toLowerCase();
        if (!contentType.startsWith("image/")) {
            return { ok: false, message: "Not an image response" };
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) return { ok: false, message: "Empty image" };
        if (buffer.length > MAX_BYTES) return { ok: false, message: "Image is too large" };
        return { ok: true, data: buffer.toString("base64"), contentType };
    } catch (error) {
        return {
            ok: false,
            message: controller.signal.aborted
                ? "Image request timed out"
                : error instanceof Error
                  ? error.message
                  : String(error),
        };
    } finally {
        clearTimeout(timer);
    }
};
