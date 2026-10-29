import fs from "node:fs";
import path from "node:path";
import type { DownloaderSource } from "@common/types/downloader";
import { app } from "electron";

type CacheEntry = {
    source: DownloaderSource;
    at: number;
};

type CacheFile = Record<string, CacheEntry>;

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const cachePath = (): string => path.join(app.getPath("userData"), "downloader-source-cache.json");

/** Host plus port, so localhost fixtures and unusual ports do not collide. */
export const hostKey = (url: string): string => {
    try {
        return new URL(url).host.toLowerCase();
    } catch {
        return "";
    }
};

const readCache = (): CacheFile => {
    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath(), "utf8")) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return parsed as CacheFile;
    } catch {
        return {};
    }
};

const writeCache = (cache: CacheFile): void => {
    try {
        fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
        fs.writeFileSync(cachePath(), JSON.stringify(cache, null, 2), "utf8");
    } catch {
        // The cache is an optimization; failures must not break downloads.
    }
};

/** False when this host recently needed the browser resolver. */
export const shouldTryExtractor = (url: string): boolean => {
    const host = hostKey(url);
    if (!host) return true;
    const entry = readCache()[host];
    if (!entry || entry.source !== "browser") return true;
    return Date.now() - entry.at > CACHE_TTL_MS;
};

export const recordSource = (url: string, source: DownloaderSource): void => {
    const host = hostKey(url);
    if (!host || source === "unknown") return;
    const cache = readCache();
    const now = Date.now();
    for (const [key, entry] of Object.entries(cache)) {
        if (!entry || now - entry.at > CACHE_TTL_MS) delete cache[key];
    }
    cache[host] = { source, at: now };
    writeCache(cache);
};
