/**
 * Brave-style ad blocking for the integrated browser.
 *
 * The primary implementation is the Ghostery Electron blocker configured with
 * EasyList + EasyPrivacy (`fromPrebuiltAdsAndTracking`). The parsed engine is
 * serialized to `<userData>/adblock-engine.bin` and restored on later launches
 * so filtering works offline and startup does not depend on a network fetch.
 *
 * Toggling uses the blocker's own `enableBlockingInSession` /
 * `disableBlockingInSession` API (rather than rebuilding request handlers).
 * That API owns both the network filters and the cosmetic-filter preload, and
 * it is idempotent per session.
 *
 * Two graceful degradation layers exist:
 * 1. If cosmetic filtering cannot be enabled (for example preload-script
 *    registration is unavailable), the same engine is retried with
 *    `loadCosmeticFilters = false` (network filtering only).
 * 2. If the engine cannot be imported/created/attached at all, a
 *    `webRequest.onBeforeRequest` host blocker is installed using a curated
 *    list plus EasyList host rules cached in `<userData>/adblock-hosts.json`.
 *
 * Main-frame navigation is never blocked. Failures are logged and never block
 * browsing.
 */

import fs from "node:fs";
import path from "node:path";
import type { BrowserAdblockState } from "@common/types/browser";
import { app, type Session } from "electron";
import { createMainLogger } from "../util/logger";
import {
    type AdblockRequest,
    type BlockedHostMatcher,
    createBlockedHostMatcher,
    DEFAULT_BLOCKED_HOSTS,
    parseEasyListHosts,
    shouldBlockRequest,
} from "./adblockFallback";

const logger = createMainLogger("BrowserAdblock");

const ENGINE_FILE_NAME = "adblock-engine.bin";
const HOSTS_CACHE_FILE_NAME = "adblock-hosts.json";
const HOSTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 45_000;
const REMOTE_LIST_URLS = [
    "https://easylist.to/easylist/easylist.txt",
    "https://easylist.to/easylist/easyprivacy.txt",
] as const;

type ElectronBlockerClass = typeof import("@ghostery/adblocker-electron").ElectronBlocker;
type ElectronBlockerInstance = import("@ghostery/adblocker-electron").ElectronBlocker;
type RequestListener = (
    details: Electron.OnBeforeRequestListenerDetails,
    callback: (response: Electron.CallbackResponse) => void,
) => void;

interface HostsCache {
    savedAt: number;
    hosts: string[];
}

let enabled = true;
let ready = false;
let blocker: ElectronBlockerInstance | null = null;
let blockerLoad: Promise<ElectronBlockerInstance | null> | null = null;
let cosmeticFiltersDisabled = false;
let fallbackMatcher: BlockedHostMatcher = createBlockedHostMatcher(DEFAULT_BLOCKED_HOSTS);
let remoteHostsLoaded = false;
let remoteHostsLoading: Promise<void> | null = null;

const sessions = new Set<Session>();
const fallbackHandlers = new Map<Session, RequestListener>();

const userDataPath = (fileName: string): string | null => {
    try {
        return path.join(app.getPath("userData"), fileName);
    } catch (error) {
        logger.debug("userData path unavailable", error);
        return null;
    }
};

/** Fetch wrapper with an abort timeout; structural `Fetch` for the engine. */
const adblockFetch = async (url: string): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

const loadCachedEngine = (ElectronBlocker: ElectronBlockerClass): ElectronBlockerInstance | null => {
    const enginePath = userDataPath(ENGINE_FILE_NAME);
    if (!enginePath) return null;

    try {
        const bytes = fs.readFileSync(enginePath);
        const restored = ElectronBlocker.deserialize(new Uint8Array(bytes));
        logger.info("loaded cached adblock engine", enginePath);
        return restored;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            logger.warn("could not restore cached adblock engine; fetching a fresh one", error);
        }
        return null;
    }
};

const cacheEngine = (engine: ElectronBlockerInstance): void => {
    const enginePath = userDataPath(ENGINE_FILE_NAME);
    if (!enginePath) return;

    try {
        fs.mkdirSync(path.dirname(enginePath), { recursive: true });
        fs.writeFileSync(enginePath, engine.serialize());
    } catch (error) {
        logger.warn("could not cache adblock engine", error);
    }
};

const loadBlocker = async (): Promise<ElectronBlockerInstance | null> => {
    let ElectronBlocker: ElectronBlockerClass;
    try {
        ({ ElectronBlocker } = await import("@ghostery/adblocker-electron"));
    } catch (error) {
        logger.warn("adblock engine module could not be loaded; using host fallback", error);
        return null;
    }

    const cached = loadCachedEngine(ElectronBlocker);
    if (cached) return cached;

    try {
        const fetched = await ElectronBlocker.fromPrebuiltAdsAndTracking(adblockFetch);
        cacheEngine(fetched);
        logger.info("adblock engine ready (EasyList + EasyPrivacy)");
        return fetched;
    } catch (error) {
        logger.warn("could not download adblock lists; using host fallback", error);
        return null;
    }
};

/** Loads the serialized engine once per process. */
const ensureBlocker = (): Promise<ElectronBlockerInstance | null> => {
    if (blocker) return Promise.resolve(blocker);
    if (blockerLoad) return blockerLoad;

    blockerLoad = loadBlocker()
        .then((loaded) => {
            blocker = loaded;
            if (loaded) ready = true;
            return loaded;
        })
        .finally(() => {
            blockerLoad = null;
        });
    return blockerLoad;
};

const setNetworkFiltersOnly = (engine: ElectronBlockerInstance): void => {
    try {
        // `Config` fields are runtime-mutable; the type marks them readonly.
        (engine.config as { loadCosmeticFilters: boolean }).loadCosmeticFilters = false;
    } catch (error) {
        logger.debug("could not disable cosmetic filters on adblock engine", error);
    }
};

const readHostsCache = (): string[] | null => {
    const cachePath = userDataPath(HOSTS_CACHE_FILE_NAME);
    if (!cachePath) return null;

    try {
        const parsed = JSON.parse(fs.readFileSync(cachePath, "utf8")) as HostsCache;
        if (!parsed || typeof parsed.savedAt !== "number" || !Array.isArray(parsed.hosts)) return null;
        if (Date.now() - parsed.savedAt > HOSTS_CACHE_TTL_MS) return null;
        return parsed.hosts.filter((host): host is string => typeof host === "string" && Boolean(host));
    } catch {
        return null;
    }
};

const writeHostsCache = (hosts: string[]): void => {
    const cachePath = userDataPath(HOSTS_CACHE_FILE_NAME);
    if (!cachePath) return;

    try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const payload: HostsCache = { savedAt: Date.now(), hosts };
        fs.writeFileSync(cachePath, JSON.stringify(payload));
    } catch (error) {
        logger.warn("could not cache remote adblock host list", error);
    }
};

const applyFallbackHosts = (hosts: string[]): void => {
    fallbackMatcher = createBlockedHostMatcher([...DEFAULT_BLOCKED_HOSTS, ...hosts]);
};

/** Loads EasyList host rules for the fallback, cached for a day. */
const loadRemoteHosts = (): Promise<void> => {
    if (remoteHostsLoaded) return Promise.resolve();
    if (remoteHostsLoading) return remoteHostsLoading;

    remoteHostsLoading = (async () => {
        const cached = readHostsCache();
        if (cached && cached.length > 0) {
            applyFallbackHosts(cached);
            remoteHostsLoaded = true;
            return;
        }

        const texts = await Promise.all(
            REMOTE_LIST_URLS.map(async (url) => {
                try {
                    const response = await adblockFetch(url);
                    if (!response.ok) throw new Error(`HTTP ${response.status}`);
                    return await response.text();
                } catch (error) {
                    logger.warn("could not download adblock host list", url, error);
                    return "";
                }
            }),
        );

        const hosts = texts.flatMap((text) => parseEasyListHosts(text));
        if (hosts.length === 0) return;

        applyFallbackHosts(hosts);
        writeHostsCache(hosts);
        remoteHostsLoaded = true;
        logger.info("adblock fallback hosts loaded", hosts.length);
    })()
        .catch((error: unknown) => logger.warn("adblock fallback host loading failed", error))
        .finally(() => {
            remoteHostsLoading = null;
        });

    return remoteHostsLoading;
};

/** Installs the session-level `onBeforeRequest` host blocker used when the engine is unavailable. */
const enableFallback = (session: Session): void => {
    if (fallbackHandlers.has(session)) return;
    void loadRemoteHosts();

    const listener: RequestListener = (details, callback) => {
        try {
            if (!enabled) {
                callback({});
                return;
            }
            const request: AdblockRequest = {
                url: details.url,
                resourceType: details.resourceType,
                referrer: details.referrer,
            };
            callback(shouldBlockRequest(request, fallbackMatcher) ? { cancel: true } : {});
        } catch (error) {
            logger.debug("adblock fallback handler failed", error);
            callback({});
        }
    };

    try {
        session.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, listener);
        fallbackHandlers.set(session, listener);
        ready = true;
        logger.warn("ad blocking is using the host-list fallback (curated hosts + cached EasyList rules)");
    } catch (error) {
        logger.warn("could not install adblock fallback handler", error);
    }
};

const disableForSession = (session: Session): void => {
    if (blocker?.isBlockingEnabled(session)) {
        try {
            blocker.disableBlockingInSession(session);
        } catch (error) {
            logger.warn("could not disable adblock engine for session", error);
        }
    }

    if (fallbackHandlers.has(session)) {
        try {
            session.webRequest.onBeforeRequest(null);
        } catch (error) {
            logger.warn("could not remove adblock fallback handler", error);
        }
        fallbackHandlers.delete(session);
    }
};

const applyToSession = async (session: Session): Promise<void> => {
    if (!enabled) return;
    if (fallbackHandlers.has(session)) return;

    const engine = await ensureBlocker();
    if (!enabled) return;

    if (!engine) {
        enableFallback(session);
        return;
    }
    if (engine.isBlockingEnabled(session)) return;

    if (!cosmeticFiltersDisabled) {
        try {
            engine.enableBlockingInSession(session);
            ready = true;
            return;
        } catch (error) {
            logger.warn("cosmetic adblock filtering unavailable; retrying with network filters only", error);
            cosmeticFiltersDisabled = true;
            try {
                if (engine.isBlockingEnabled(session)) engine.disableBlockingInSession(session);
            } catch (disableError) {
                logger.debug("could not clean up failed adblock context", disableError);
            }
            setNetworkFiltersOnly(engine);
        }
    }

    try {
        engine.enableBlockingInSession(session);
        ready = true;
    } catch (error) {
        logger.warn("adblock engine could not attach to session; using host fallback", error);
        enableFallback(session);
    }
};

/**
 * Registers a session for ad blocking. Safe to call more than once; the engine
 * loads lazily in the background and failures fall back to host blocking.
 */
export const enableAdblockInSession = (session: Session): void => {
    sessions.add(session);
    if (!enabled) return;
    void applyToSession(session).catch((error: unknown) => logger.warn("could not enable adblock", error));
};

export const getAdblockState = (): BrowserAdblockState => {
    return { enabled, ready };
};

/** Enables/disables blocking in every registered browser session. */
export const setAdblockEnabled = (next: boolean): BrowserAdblockState => {
    enabled = next;
    for (const session of sessions) {
        if (next) {
            void applyToSession(session).catch((error: unknown) => logger.warn("could not enable adblock", error));
        } else {
            disableForSession(session);
        }
    }
    return getAdblockState();
};
