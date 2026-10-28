import fs from "node:fs";
import path from "node:path";
import { createMainLogger } from "@electron/util/logger";
import { app, net } from "electron";

const logger = createMainLogger("browser/siteIcons");

/** Cache folder; icons survive restarts and work offline after the first fetch. */
const CACHE_DIR_NAME = "browser-icons";
const MAX_ICON_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const HOST_RE = /^[a-z0-9.-]+$/i;

type CachedIcon = { mime: string; data: string };

const memory = new Map<string, string>();
const inFlight = new Map<string, Promise<string | null>>();

const cacheDirectory = (): string => path.join(app.getPath("userData"), CACHE_DIR_NAME);

const cachePath = (host: string): string => path.join(cacheDirectory(), `${host}.json`);

const readCached = (host: string): string | null => {
    const fromMemory = memory.get(host);
    if (fromMemory) return fromMemory;
    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath(host), "utf8")) as Partial<CachedIcon>;
        if (typeof parsed.mime !== "string" || typeof parsed.data !== "string" || !parsed.data) return null;
        const dataUrl = `data:${parsed.mime};base64,${parsed.data}`;
        memory.set(host, dataUrl);
        return dataUrl;
    } catch {
        return null;
    }
};

const writeCached = (host: string, mime: string, data: string): void => {
    try {
        fs.mkdirSync(cacheDirectory(), { recursive: true });
        const payload: CachedIcon = { mime, data };
        fs.writeFileSync(cachePath(host), JSON.stringify(payload), "utf8");
    } catch (error) {
        logger.warn("could not cache site icon", { host, error });
    }
};

const candidateUrls = (host: string): string[] => [
    `https://www.google.com/s2/favicons?sz=128&domain=${encodeURIComponent(host)}`,
    `https://icons.duckduckgo.com/ip3/${host}.ico`,
    `https://${host}/favicon.ico`,
];

const fetchIcon = async (host: string): Promise<string | null> => {
    for (const url of candidateUrls(host)) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const response = await net.fetch(url, { signal: controller.signal });
            if (!response.ok) continue;
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length === 0 || buffer.length > MAX_ICON_BYTES) continue;
            const mime = response.headers.get("content-type")?.split(";")[0]?.trim() || "image/png";
            if (!mime.startsWith("image/")) continue;
            const data = buffer.toString("base64");
            writeCached(host, mime, data);
            const dataUrl = `data:${mime};base64,${data}`;
            memory.set(host, dataUrl);
            return dataUrl;
        } catch (error) {
            logger.debug("site icon candidate failed", { host, url, error });
        } finally {
            clearTimeout(timer);
        }
    }
    return null;
};

/**
 * Returns cached data URLs keyed by host. Missing icons are fetched once from
 * the site/Google/DuckDuckGo and stored under `userData/browser-icons`.
 */
export const getSiteIconDataUrls = async (hosts: readonly string[]): Promise<Record<string, string>> => {
    const unique = [...new Set(hosts.map((host) => host.trim().toLowerCase()))].filter((host) =>
        HOST_RE.test(host),
    );
    const result: Record<string, string> = {};

    await Promise.all(
        unique.slice(0, 40).map(async (host) => {
            const cached = readCached(host);
            if (cached) {
                result[host] = cached;
                return;
            }
            let pending = inFlight.get(host);
            if (!pending) {
                pending = fetchIcon(host).finally(() => inFlight.delete(host));
                inFlight.set(host, pending);
            }
            const icon = await pending;
            if (icon) result[host] = icon;
        }),
    );

    return result;
};
