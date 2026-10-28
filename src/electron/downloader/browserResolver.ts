import { BROWSER_SESSION_PARTITION } from "@electron/browser/BrowserManager";
import { applyProxyToSession } from "@electron/network/proxySettings";
import { createMainLogger } from "@electron/util/logger";
import { BrowserWindow, session as electronSession } from "electron";

const log = createMainLogger("downloader/resolver");

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const IMAGE_EXT_RE = /\.(?:jpe?g|png|webp|gif|bmp|avif|jxl)(?:[?#]|$)/i;
const IMAGE_LIKE_RE = /(?:image|images|img|media|upload|uploads|cdn|photo|picture|gallery)/i;
const AD_RE =
    /(?:^|[/_.-])(?:logo|favicon|sprite|avatar|emoji|icon|badge|banner|advert|ads?|adsmg|pixel|tracking|spinner|placeholder|loading|landing|landingpage|hero|background|bg|errors?|skip|og-image|covers?|visa|thumbnails?|thumbs?|seriesthumb|closed-assets|dflazy|cursorleft|cursorright|backtotop|home-user|promos?|android-chrome|spots?|mascot|newsletter|smoketile|social|share|ajax-loader|loader|read_left_arrow)(?:[/_.-]|$)/i;
const STRONG_AD_RE =
    /(?:^|[/_.-])(?:logo|favicon|sprite|avatar|emoji|icon|badge|banner|advert|ads?|adsmg|pixel|tracking|landing|landingpage|hero|background|bg|errors?|skip|og-image|covers?|visa|thumbnails?|thumbs?|seriesthumb|closed-assets|dflazy|cursorleft|cursorright|backtotop|home-user|promos?|android-chrome|spots?|mascot|newsletter|smoketile|social|share|ajax-loader|loader|read_left_arrow)(?:[/_.-]|$)/i;
const CHAPTER_HINT_RE =
    /(?:chapter|chap|ch\.?|episode|ep\.?|volume|vol\.?|chuong|chương|hồi)\s*([0-9]+(?:[.,][0-9]+)?)/i;
const CHAPTER_QUERY_RE = /[?&](?:chapter|chap|ch|episode|epi|ep|volume|vol)(?:_no)?=(\d+)/i;
const CHAPTER_PATH_RE = /\/(?:chapter|chap|episode|read|reader|view|viewer|chuong|chương|hoi|hồi)(?:[/_-]|$)/i;
const READER_PATH_RE =
    /(?:^|\/)(?:chapter|chap|episode|read|reader|view|viewer|chuong|chương|hoi|hồi)(?:[/_-]|$)|\/(?:page|paged)(?:\/|=|$)|[?&](?:page|p|paged|offset)=\d+/i;
const NEXT_TEXT_RE = /^(?:next|next page|next ›|next »|›|»|→|>|下一页|下一頁|次へ)$/i;
const NEXT_PAGE_TEXT_RE = /next page|next ›|›|»|→|下一页|下一頁|次へ/i;

type RawImage = {
    url: string;
    width: number;
    height: number;
    area: number;
    source: string;
};

type RawLink = {
    href: string;
    text: string;
    rel: string;
};

type PageData = {
    title: string;
    h1: string;
    ogTitle: string;
    images: RawImage[];
    links: RawLink[];
    scriptUrls: string[];
    networkImages: string[];
};

export type ResolvedDownloadItem = {
    url: string;
    referer?: string;
};

export type ResolvedDownload = {
    title: string;
    mode: "image" | "gallery" | "reader" | "series";
    items: ResolvedDownloadItem[];
    headers: Record<string, string>;
    chapters: number;
    pages: number;
};

const envInt = (name: string, fallback: number): number => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

const MAX_CHAPTERS = envInt("YOPOMURA_RESOLVER_MAX_CHAPTERS", 300);
const MAX_IMAGES = envInt("YOPOMURA_RESOLVER_MAX_IMAGES", 12000);
const MAX_READER_PAGES = envInt("YOPOMURA_RESOLVER_MAX_READER_PAGES", 30);
const MAX_RESOLVE_MS = envInt("YOPOMURA_RESOLVER_MAX_MS", 240_000);
const PAGE_TIMEOUT_MS = envInt("YOPOMURA_RESOLVER_PAGE_MS", 25_000);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
};

const baseDomain = (host: string): string => host.split(".").slice(-2).join(".");

const sameSite = (left: string, right: string): boolean =>
    Boolean(left && right) && (left === right || baseDomain(left) === baseDomain(right));

const normalizeHttpUrl = (raw: string, base?: string): string | null => {
    try {
        const url = new URL(raw.trim(), base);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;
        url.hash = "";
        return url.href;
    } catch {
        return null;
    }
};

const isDirectImage = (url: string): boolean => IMAGE_EXT_RE.test(new URL(url).pathname);

const imageKey = (url: string): string => {
    try {
        const parsed = new URL(url);
        return `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    } catch {
        return url;
    }
};

const linkNumber = (link: RawLink): number | null => {
    const match = `${link.text} ${link.href}`.match(CHAPTER_HINT_RE);
    if (match?.[1]) return Number(match[1].replace(",", "."));
    const query = new URL(link.href).search.match(CHAPTER_QUERY_RE);
    if (query?.[1]) return Number(query[1]);
    const segments = new URL(link.href).pathname.split("/").filter(Boolean);
    for (let index = segments.length - 1; index >= 0; index -= 1) {
        const value = Number(segments[index]);
        if (Number.isFinite(value) && value >= 0) return value;
    }
    return null;
};

const chapterGroupKey = (href: string): string => {
    const parsed = new URL(href);
    const segments = parsed.pathname
        .split("/")
        .filter(Boolean)
        .map((segment) => {
            if (/^\d+(?:[.,]\d+)?$/.test(segment)) return "*";
            if (/^[0-9a-f]{8}-[0-9a-f-]{20,}$/i.test(segment)) return "*";
            if (/^[0-9a-f]{16,}$/i.test(segment)) return "*";
            if (/(?:chapter|chap|episode|epi|chuong|chương|hoi|hồi)[-_]?\d+/i.test(segment)) return "*";
            return segment;
        });
    const search = [...parsed.searchParams.entries()]
        .filter(([key]) => !/^(?:chapter|chap|ch|episode|epi|ep|page|p|paged|offset|vol|volume)$/i.test(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => `${key}=${value}`)
        .join("&");
    return `${parsed.hostname}/${segments.join("/")}?${search}`;
};

/** Links that look like individual chapters on a series page. */
export const detectChapterLinks = (links: readonly RawLink[], pageUrl: string): RawLink[] => {
    const pageHost = hostOf(pageUrl);
    const seen = new Set<string>();
    const rows: RawLink[] = [];

    for (const link of links) {
        const href = normalizeHttpUrl(link.href, pageUrl);
        if (!href || href === pageUrl) continue;
        const host = hostOf(href);
        if (!sameSite(host, pageHost)) continue;

        const text = link.text.replace(/\s+/g, " ").trim();
        if (/^(?:next|previous|prev|back|home|login|register|search|random)\b/i.test(text)) continue;
        if (/(?:comment|genre|tag|author|artist|catalog|category|chapter list|episode list)\b/i.test(text)) {
            continue;
        }

        const parsed = new URL(href);
        const combined = `${text} ${href}`;
        const hasChapterSignal =
            CHAPTER_HINT_RE.test(combined) ||
            CHAPTER_PATH_RE.test(`${parsed.pathname}${parsed.search}`) ||
            CHAPTER_QUERY_RE.test(parsed.search);
        if (!hasChapterSignal) continue;
        if (!/\d/.test(combined) && !CHAPTER_QUERY_RE.test(parsed.search)) continue;

        const key = imageKey(href);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({ href, text, rel: link.rel });
        if (rows.length >= MAX_CHAPTERS * 4) break;
    }

    const groups = new Map<string, RawLink[]>();
    for (const row of rows) {
        const key = chapterGroupKey(row.href);
        const group = groups.get(key) ?? [];
        group.push(row);
        groups.set(key, group);
    }
    const largest = [...groups.values()].sort((left, right) => right.length - left.length)[0] ?? [];
    const selected = largest.length >= 2 ? largest : [];
    selected.sort((left, right) => {
        const leftNumber = linkNumber(left);
        const rightNumber = linkNumber(right);
        if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
            return leftNumber - rightNumber;
        }
        return 0;
    });
    return selected.slice(0, MAX_CHAPTERS);
};

/** A tab/link that opens the full chapter or episode list. */
export const findChapterListLink = (links: readonly RawLink[], pageUrl: string): string | null => {
    const pageHost = hostOf(pageUrl);
    for (const link of links) {
        const href = normalizeHttpUrl(link.href, pageUrl);
        if (!href || href === pageUrl) continue;
        if (!sameSite(hostOf(href), pageHost)) continue;
        const text = link.text.replace(/\s+/g, " ").trim();
        if (/(?:^|\b)(?:chapters|chapter list|episodes|episode list)(?:\b|$)/i.test(text)) {
            return href;
        }
        if (/(?:[?&]tab=chapters|[/]chapters(?:[/?#]|$))/i.test(href)) return href;
    }
    return null;
};

/** A next-page link inside the same chapter/gallery, not a next-chapter link. */
export const detectNextPage = (links: readonly RawLink[], pageUrl: string): string | null => {
    const current = new URL(pageUrl);
    for (const link of links) {
        const href = normalizeHttpUrl(link.href, pageUrl);
        if (!href || href === pageUrl) continue;

        const text = link.text.replace(/\s+/g, " ").trim();
        const rel = link.rel.toLowerCase();
        const looksNext = rel.includes("next") || NEXT_TEXT_RE.test(text) || NEXT_PAGE_TEXT_RE.test(text);
        if (!looksNext) continue;
        if (/chapter|chap|episode|chuong|chương/i.test(text)) continue;

        let next: URL;
        try {
            next = new URL(href);
        } catch {
            continue;
        }
        if (next.hostname !== current.hostname) continue;

        const currentPath = current.pathname.replace(/\/$/, "");
        const samePath = next.pathname.replace(/\/$/, "") === currentPath;
        const prefixed = next.pathname.startsWith(`${currentPath}/`);
        const queryPage = /(?:^|[?&])(?:page|p|paged|offset)=\d+/i.test(next.search);
        if (samePath || prefixed || queryPage) return href;
    }
    return null;
};

export const isReaderUrl = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        return READER_PATH_RE.test(`${parsed.pathname}${parsed.search}`);
    } catch {
        return false;
    }
};

const cleanTitle = (page: PageData, fallback: string): string => {
    const raw = (page.ogTitle || page.h1 || page.title || fallback).replace(/\s+/g, " ").trim();
    if (!raw) return fallback;
    const shortened = raw.replace(/\s*[|–—]\s*[^|–—]{1,42}$/, "").trim();
    return shortened || raw;
};

const filterImages = (page: PageData, pageUrl: string): RawImage[] => {
    const rows: RawImage[] = [];
    const seen = new Set<string>();

    const accept = (image: RawImage) => {
        const url = normalizeHttpUrl(image.url, pageUrl);
        if (!url || !url.startsWith("http")) return;
        const key = imageKey(url);
        if (seen.has(key)) return;

        const path = new URL(url).pathname;
        const search = new URL(url).search;
        const host = new URL(url).hostname;
        const width = Math.max(0, Math.floor(image.width));
        const height = Math.max(0, Math.floor(image.height));
        const area = width > 0 && height > 0 ? width * height : Math.max(0, Math.floor(image.area));
        const knownSize = width > 0 && height > 0;
        const small = knownSize && (Math.max(width, height) < 200 || area < 35_000);
        if (small) return;
        if (STRONG_AD_RE.test(path)) return;
        if (/@\d+(?:\.\d+)?(?:\.(?:jpe?g|png|webp)(?:$|[?#]))?/i.test(path)) return;
        if (/[?&]w=\d+/i.test(search) && Number(new URL(url).searchParams.get("w")) < 600) return;
        if (/[?&]type=f\d+_\d+/i.test(search)) return;
        if (/^t\d+\./i.test(host) && /\/galleries\//i.test(path)) return;
        if (/\d+t\.(?:jpe?g|png|webp)$/i.test(path) && /\/galleries\//i.test(path)) return;
        if (/[?&]type=(?:a\d+|crop\d*_?\d*|thumb|small|medium|cover)/i.test(search)) return;
        if (
            /manga_series_link_img|seriesthumbnails|400x320|products\/|defaultuser|resources\/images|feelinglucky/i.test(
                path,
            )
        ) {
            return;
        }
        if (AD_RE.test(path) && (!knownSize || Math.max(width, height) < 500)) return;
        if (/thumbnail|thumb/i.test(path) && (!knownSize || Math.max(width, height) < 400)) return;
        if (/\.svg$/i.test(path) && (!knownSize || Math.max(width, height) < 600)) return;

        const hasImageExtension = IMAGE_EXT_RE.test(path);
        const imageLike = hasImageExtension || IMAGE_LIKE_RE.test(path);
        if (!imageLike && image.source !== "network" && image.source !== "dom") return;
        if (!imageLike && !knownSize) return;

        seen.add(key);
        rows.push({ url, width, height, area, source: image.source });
    };

    for (const image of page.images) accept(image);
    for (const url of page.networkImages) accept({ url, width: 0, height: 0, area: 0, source: "network" });
    for (const raw of page.scriptUrls) accept({ url: raw, width: 0, height: 0, area: 0, source: "script" });

    return rows.slice(0, MAX_IMAGES);
};

const scrollPage = async (contents: Electron.WebContents): Promise<void> => {
    const script = `
        (async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            let previous = 0;
            for (let step = 0; step < 8; step += 1) {
                window.scrollBy(0, Math.max(500, Math.floor(window.innerHeight * 0.9)));
                await wait(220);
                const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
                if (height === previous) break;
                previous = height;
            }
            window.scrollTo(0, 0);
            await wait(250);
        })();
    `;
    await contents.executeJavaScript(script, true).catch(() => undefined);
};

const waitForPageContent = async (contents: Electron.WebContents): Promise<void> => {
    const script = `
        (async () => {
            const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const deadline = Date.now() + 12000;
            while (Date.now() < deadline) {
                const links = document.querySelectorAll("a[href]").length;
                const images = document.images.length;
                if (document.readyState === "complete" && (links > 5 || images > 2)) return;
                await wait(200);
            }
        })();
    `;
    await contents.executeJavaScript(script, true).catch(() => undefined);
};

const extractPage = (): Omit<PageData, "networkImages"> => {
    const absolute = (raw: string | null | undefined): string => {
        if (!raw) return "";
        try {
            const url = new URL(raw, location.href);
            return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
        } catch {
            return "";
        }
    };

    const parseSrcset = (value: string): string => {
        let best = "";
        let bestScore = -1;
        for (const part of value.split(",")) {
            const pieces = part.trim().split(/\s+/);
            const url = pieces[0];
            if (!url) continue;
            const descriptor = pieces[1] || "1x";
            const score = Number.parseFloat(descriptor) || 1;
            if (score > bestScore) {
                bestScore = score;
                best = url;
            }
        }
        return best;
    };

    const images: RawImage[] = [];
    const seen = new Set<string>();
    const add = (raw: string, source: string, element?: HTMLImageElement | HTMLElement | null) => {
        const url = absolute(raw);
        if (!url || seen.has(url)) return;
        seen.add(url);
        const image = element instanceof HTMLImageElement ? element : null;
        const width = image?.naturalWidth || image?.width || element?.clientWidth || 0;
        const height = image?.naturalHeight || image?.height || element?.clientHeight || 0;
        images.push({
            url,
            width,
            height,
            area: width * height,
            source,
        });
    };

    const lazyAttributes = [
        "data-src",
        "data-original",
        "data-lazy-src",
        "data-url",
        "data-image",
        "data-cfsrc",
        "data-pagespeed-lazy-src",
        "data-echo",
        "data-lazy",
        "data-original-src",
        "data-full",
        "data-large",
    ];

    for (const image of Array.from(document.images)) {
        add(image.currentSrc || image.src, "dom", image);
        if (image.srcset) add(parseSrcset(image.srcset), "dom", image);
        for (const name of lazyAttributes) {
            const value = image.getAttribute(name);
            if (value) add(value, "dom", image);
        }
    }

    for (const source of Array.from(document.querySelectorAll("source[srcset]"))) {
        add(parseSrcset(source.getAttribute("srcset") || ""), "dom", source as HTMLElement);
    }

    for (const element of Array.from(document.querySelectorAll<HTMLElement>("[style*='background']")).slice(
        0,
        4000,
    )) {
        const background = getComputedStyle(element).backgroundImage;
        const match = background.match(/url\(["']?([^"')]+)["']?\)/i);
        if (match) add(match[1], "dom", element);
    }

    for (const meta of Array.from(
        document.querySelectorAll("meta[property='og:image'], meta[name='twitter:image']"),
    )) {
        add(meta.getAttribute("content") || "", "dom");
    }

    for (const link of Array.from(
        document.querySelectorAll("link[rel='preload'][as='image'], link[rel='image_src']"),
    )) {
        add(link.getAttribute("href") || "", "dom");
    }

    const links: RawLink[] = [];
    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).slice(0, 4000)) {
        const href = anchor.href;
        if (!href) continue;
        links.push({
            href,
            text: (anchor.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160),
            rel: anchor.rel || "",
        });
    }
    for (const link of Array.from(document.querySelectorAll("link[rel='next']"))) {
        const href = absolute(link.getAttribute("href"));
        if (href) links.push({ href, text: "", rel: "next" });
    }

    const scriptUrls: string[] = [];
    const scriptSeen = new Set<string>();
    for (const script of Array.from(document.scripts).slice(0, 200)) {
        const text = script.textContent || "";
        if (!text || text.length > 2_000_000) continue;
        const normalized = text.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
        const matches = normalized.match(/https?:\/\/[^"'\s<>]+/g) || [];
        for (const match of matches) {
            const url = match.replace(/[),.;\\]+$/, "");
            if (
                !/\.(jpe?g|png|webp|gif|bmp|avif|jxl)(?:[?#]|$)/i.test(url) &&
                !/image|img|media|upload|cdn|photo/i.test(url)
            ) {
                continue;
            }
            if (scriptSeen.has(url)) continue;
            scriptSeen.add(url);
            scriptUrls.push(url);
            if (scriptUrls.length >= 400) break;
        }
        if (scriptUrls.length >= 400) break;
    }

    return {
        title: document.title || "",
        h1: document.querySelector("h1")?.textContent?.trim() || "",
        ogTitle:
            document.querySelector("meta[property='og:title']")?.getAttribute("content")?.trim() ||
            document.querySelector("meta[name='twitter:title']")?.getAttribute("content")?.trim() ||
            "",
        images,
        links,
        scriptUrls,
    };
};

class PageRenderer {
    private window: BrowserWindow | null = null;
    private debuggerAttached = false;
    private networkImages = new Set<string>();
    private downloadHandler:
        | ((event: Electron.Event, item: Electron.DownloadItem, contents: Electron.WebContents) => void)
        | null = null;

    private async ensureWindow(): Promise<BrowserWindow> {
        if (this.window && !this.window.isDestroyed()) return this.window;

        const browserSession = electronSession.fromPartition(BROWSER_SESSION_PARTITION, { cache: true });
        await applyProxyToSession(browserSession);
        const window = new BrowserWindow({
            show: false,
            width: 1280,
            height: 900,
            skipTaskbar: true,
            webPreferences: {
                session: browserSession,
                nodeIntegration: false,
                nodeIntegrationInWorker: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false,
                webviewTag: false,
                backgroundThrottling: false,
            },
        });
        window.webContents.setUserAgent(USER_AGENT);
        window.webContents.setAudioMuted(true);
        window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        this.downloadHandler = (event, item, contents) => {
            if (contents !== window.webContents) return;
            event.preventDefault();
            item.cancel();
        };
        browserSession.on("will-download", this.downloadHandler);
        this.window = window;

        try {
            await Promise.race([
                window.webContents.debugger.attach("1.3"),
                sleep(2000).then(() => {
                    throw new Error("debugger attach timed out");
                }),
            ]);
            this.debuggerAttached = window.webContents.debugger.isAttached();
            if (this.debuggerAttached) {
                window.webContents.debugger.on("message", (_event, method, params: unknown) => {
                    if (method !== "Network.responseReceived") return;
                    const payload = params as {
                        type?: string;
                        response?: { url?: string; mimeType?: string };
                    };
                    if (payload.type !== "Image" && !payload.response?.mimeType?.startsWith("image/")) return;
                    const url = payload.response?.url;
                    if (url?.startsWith("http")) this.networkImages.add(url);
                });
                void window.webContents.debugger.sendCommand("Network.enable").catch(() => undefined);
            }
        } catch (error) {
            log.warn("could not attach browser debugger", error);
        }
        return window;
    }

    async render(url: string): Promise<PageData> {
        const window = await this.ensureWindow();
        const contents = window.webContents;
        this.networkImages = new Set();

        await Promise.race([contents.loadURL(url).catch(() => undefined), sleep(PAGE_TIMEOUT_MS)]);
        await sleep(400);
        await waitForPageContent(contents);
        await scrollPage(contents);
        await sleep(650);

        let data: Omit<PageData, "networkImages">;
        try {
            data = (await contents.executeJavaScript(`(${extractPage.toString()})()`, true)) as Omit<
                PageData,
                "networkImages"
            >;
        } catch (error) {
            log.warn("could not extract browser page", { url, error });
            data = { title: "", h1: "", ogTitle: "", images: [], links: [], scriptUrls: [] };
        }

        return {
            ...data,
            networkImages: [...this.networkImages],
        };
    }

    close(): void {
        const window = this.window;
        this.window = null;
        if (this.downloadHandler) {
            try {
                electronSession
                    .fromPartition(BROWSER_SESSION_PARTITION)
                    .removeListener("will-download", this.downloadHandler);
            } catch {
                // session already gone
            }
            this.downloadHandler = null;
        }
        if (!window || window.isDestroyed()) return;
        try {
            if (this.debuggerAttached && window.webContents.debugger.isAttached()) {
                window.webContents.debugger.detach();
            }
        } catch {
            // already detached
        }
        this.debuggerAttached = false;
        try {
            window.destroy();
        } catch {
            // already destroyed
        }
    }
}

const cookiesFor = async (url: string, items: readonly ResolvedDownloadItem[]): Promise<string> => {
    const pageHost = hostOf(url);
    if (!pageHost || items.length === 0) return "";
    if (!items.every((item) => sameSite(hostOf(item.url), pageHost))) return "";
    const browserSession = electronSession.fromPartition(BROWSER_SESSION_PARTITION, { cache: true });
    const cookies = await browserSession.cookies.get({});
    const matching = cookies.filter((cookie) => {
        const domain = (cookie.domain || "").replace(/^\./, "").toLowerCase();
        return pageHost === domain || pageHost.endsWith(`.${domain}`);
    });
    return matching.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
};

const buildHeaders = async (
    pageUrl: string,
    items: readonly ResolvedDownloadItem[],
): Promise<Record<string, string>> => {
    const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
    };
    const cookie = await cookiesFor(pageUrl, items).catch(() => "");
    if (cookie) headers.Cookie = cookie;
    return headers;
};

const collectPageImages = (page: PageData, pageUrl: string): RawImage[] => filterImages(page, pageUrl);

const collectReaderItems = async (
    renderer: PageRenderer,
    startUrl: string,
    firstPage: PageData,
    signal: AbortSignal | undefined,
    deadline: number,
): Promise<{ items: ResolvedDownloadItem[]; pages: number; title: string }> => {
    const items: ResolvedDownloadItem[] = [];
    const seen = new Set<string>();
    let page = firstPage;
    let url = startUrl;
    let pages = 0;

    for (let index = 0; index < MAX_READER_PAGES; index += 1) {
        if (signal?.aborted) throw new Error("Download cancelled");
        if (Date.now() > deadline) break;
        const images = collectPageImages(page, url);
        for (const image of images) {
            const key = imageKey(image.url);
            if (seen.has(key)) continue;
            seen.add(key);
            items.push({ url: image.url, referer: url });
            if (items.length >= MAX_IMAGES) break;
        }
        pages += 1;
        if (items.length >= MAX_IMAGES) break;
        const next = detectNextPage(page.links, url);
        if (!next) break;
        const nextPage = await renderer.render(next);
        page = nextPage;
        url = next;
    }

    return { items, pages, title: cleanTitle(firstPage, hostOf(startUrl) || "download") };
};

/** Resolve a page/series URL into a concrete list of downloadable image URLs. */
export const resolveDownload = async (inputUrl: string, signal?: AbortSignal): Promise<ResolvedDownload> => {
    const url = normalizeHttpUrl(inputUrl);
    if (!url) throw new Error("URL must start with http:// or https://");

    if (isDirectImage(url)) {
        const item = { url, referer: url };
        return {
            title: decodeURIComponent(new URL(url).pathname.split("/").pop() || "image"),
            mode: "image",
            items: [item],
            headers: await buildHeaders(url, [item]),
            chapters: 0,
            pages: 1,
        };
    }

    const renderer = new PageRenderer();
    const deadline = Date.now() + MAX_RESOLVE_MS;
    try {
        let firstPage = await renderer.render(url);
        const title = cleanTitle(firstPage, hostOf(url) || "download");
        const reader = isReaderUrl(url);
        let chapterLinks = detectChapterLinks(firstPage.links, url);
        let pageImages = collectPageImages(firstPage, url);
        let chapterListLink: string | null = null;

        if (!reader && chapterLinks.length < 2) {
            chapterListLink = findChapterListLink(firstPage.links, url);
            if (chapterListLink) {
                const listPage = await renderer.render(chapterListLink);
                const listChapters = detectChapterLinks(listPage.links, chapterListLink);
                if (listChapters.length >= 2) {
                    chapterLinks = listChapters;
                    pageImages = collectPageImages(listPage, chapterListLink);
                    firstPage = listPage;
                }
            }
        }

        log.info("resolver page", {
            url,
            title,
            links: firstPage.links.length,
            chapters: chapterLinks.length,
            images: pageImages.length,
            reader,
            hints: firstPage.links
                .filter((link) => /chapter|chap|episode|read|viewer|no=\d+/i.test(`${link.href} ${link.text}`))
                .slice(0, 8)
                .map((link) => ({ text: link.text.slice(0, 40), href: link.href })),
        });

        const errorPage =
            /\b(?:404|not found|forbidden|access denied|just a moment|attention required|error)\b/i.test(
                `${firstPage.title} ${firstPage.h1}`,
            ) || /^(?:error|404)\b/i.test(title);
        if (errorPage && pageImages.length <= 2) {
            log.warn("resolver reached an error page", { url, title });
            return {
                title,
                mode: "gallery",
                items: [],
                headers: {},
                chapters: 0,
                pages: 1,
            };
        }

        const inputPath = new URL(url).pathname.replace(/\/+$/, "");
        const rootOrListing =
            inputPath === "" ||
            /\/(?:search|tag|genre|category|directory|latest|popular|browse|info)(?:\/|$)/i.test(inputPath);
        if (!reader && rootOrListing) {
            log.info("resolver skipped a listing page; using fallback", { url, title });
            return {
                title,
                mode: "gallery",
                items: [],
                headers: {},
                chapters: 0,
                pages: 1,
            };
        }

        if (!reader && chapterLinks.length < 2 && (pageImages.length < 3 || chapterListLink)) {
            log.info("resolver found too little content; using fallback", {
                url,
                title,
                images: pageImages.length,
            });
            return {
                title,
                mode: "gallery",
                items: [],
                headers: {},
                chapters: 0,
                pages: 1,
            };
        }

        if (!reader && chapterLinks.length >= 2) {
            const items: ResolvedDownloadItem[] = [];
            const seen = new Set<string>();
            let pages = 0;
            let completedChapters = 0;

            for (const chapter of chapterLinks) {
                if (signal?.aborted) throw new Error("Download cancelled");
                if (Date.now() > deadline) {
                    log.warn("series resolution reached time limit", { url, chapters: completedChapters });
                    break;
                }
                try {
                    const page = await renderer.render(chapter.href);
                    const resolved = await collectReaderItems(renderer, chapter.href, page, signal, deadline);
                    pages += resolved.pages;
                    for (const item of resolved.items) {
                        const key = imageKey(item.url);
                        if (seen.has(key)) continue;
                        seen.add(key);
                        items.push(item);
                        if (items.length >= MAX_IMAGES) break;
                    }
                    completedChapters += 1;
                } catch (error) {
                    log.warn("chapter resolution failed", { chapter: chapter.href, error });
                }
                if (items.length >= MAX_IMAGES) break;
            }

            return {
                title,
                mode: "series",
                items: items.length >= 2 ? items : [],
                headers: items.length >= 2 ? await buildHeaders(url, items) : {},
                chapters: completedChapters,
                pages,
            };
        }

        const resolved = await collectReaderItems(renderer, url, firstPage, signal, deadline);
        return {
            title: resolved.title,
            mode: reader ? "reader" : "gallery",
            items: resolved.items,
            headers: await buildHeaders(url, resolved.items),
            chapters: reader ? 1 : 0,
            pages: resolved.pages,
        };
    } finally {
        renderer.close();
    }
};
