/**
 * Host/URL matching for the ad-blocking fallback and unit tests.
 *
 * The primary path uses `@ghostery/adblocker-electron` with a Brave/uBO list
 * set. If that engine cannot load or attach to an Electron session,
 * `adblock.ts` registers a `webRequest.onBeforeRequest` handler driven by the
 * pure helpers in this module. Nothing here imports Electron so it stays unit
 * testable.
 */

export interface AdblockRequest {
    url: string;
    /** Electron `OnBeforeRequestListenerDetails.resourceType`. */
    resourceType?: string;
    referrer?: string;
}

export type BlockedHostMatcher = (host: string) => boolean;

/**
 * Small curated list used immediately (and while remote EasyList hosts are
 * still being fetched) so the fallback is never inert.
 */
export const DEFAULT_BLOCKED_HOSTS: readonly string[] = [
    "2mdn.net",
    "33across.com",
    "adcolony.com",
    "adnxs.com",
    "adsrvr.org",
    "amazon-adsystem.com",
    "amplitude.com",
    "applovin.com",
    "appsflyer.com",
    "bidswitch.net",
    "branch.io",
    "casalemedia.com",
    "chartbeat.com",
    "criteo.com",
    "criteo.net",
    "doubleclick.net",
    "facebook.net",
    "google-analytics.com",
    "googleadservices.com",
    "googlesyndication.com",
    "googletagmanager.com",
    "googletagservices.com",
    "hotjar.com",
    "inmobi.com",
    "media.net",
    "mixpanel.com",
    "mopub.com",
    "moatads.com",
    "openx.net",
    "outbrain.com",
    "pubmatic.com",
    "quantserve.com",
    "quantcount.com",
    "rubiconproject.com",
    "scorecardresearch.com",
    "segment.io",
    "serving-sys.com",
    "smartadserver.com",
    "taboola.com",
    "unityads.unity3d.com",
    "zedo.com",
];

const HTTP_PROTOCOL_RE = /^https?:$/i;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const EASYLIST_HOST_RE = /^\|\|([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\^/i;
const HOSTS_FILE_RE = /^(?:0\.0\.0\.0|127\.0\.0\.1)[\t ]+([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?:[\t ]|$)/i;

/** Resource types whose URL should never be cancelled by the fallback. */
const NAVIGATION_RESOURCE_TYPES = new Set(["mainframe", "main-frame"]);

/**
 * Conservative path heuristics for ad endpoints served from shared CDNs.
 * They only apply to third-party subresources (see {@link shouldBlockRequest}).
 */
const BLOCKED_PATH_PATTERNS: readonly RegExp[] = [
    /\/ads?\//i,
    /\/pagead\//i,
    /\/adserver\//i,
    /\/adsystem\//i,
    /\/advert(?:isement|ising)?\//i,
    /\/analytics\.js(?:[?#]|$)/i,
    /\/gtag\/js(?:[?#]|$)/i,
    /\/gtm\.js(?:[?#]|$)/i,
];

/** Lowercases a host and drops a single trailing dot. */
export const normalizeAdblockHost = (host: string): string => {
    return host.trim().toLowerCase().replace(/\.$/, "");
};

const isValidHostname = (host: string): boolean => {
    if (!host || host.length > 253) return false;
    if (host.startsWith("[") && host.endsWith("]")) return true;
    if (IPV4_RE.test(host)) {
        return host.split(".").every((part) => Number(part) <= 255);
    }
    return host.split(".").every((label) => Boolean(label) && label.length <= 63 && HOST_LABEL_RE.test(label));
};

/**
 * Builds an O(labels) matcher for a host list: an entry blocks itself and all
 * of its subdomains. `localhost` and IP literals never match domain entries,
 * so local development is unaffected.
 */
export const createBlockedHostMatcher = (blockedHosts: Iterable<string>): BlockedHostMatcher => {
    const domains = new Set<string>();
    for (const entry of blockedHosts) {
        const domain = normalizeAdblockHost(entry);
        if (domain) domains.add(domain);
    }

    return (host: string): boolean => {
        const normalized = normalizeAdblockHost(host);
        if (!normalized) return false;
        if (normalized === "localhost" || normalized.endsWith(".localhost")) return false;
        if (normalized.startsWith("[") || IPV4_RE.test(normalized)) return false;

        if (domains.has(normalized)) return true;
        let index = normalized.indexOf(".");
        while (index !== -1) {
            if (domains.has(normalized.slice(index + 1))) return true;
            index = normalized.indexOf(".", index + 1);
        }
        return false;
    };
};

const DEFAULT_HOST_MATCHER = createBlockedHostMatcher(DEFAULT_BLOCKED_HOSTS);

/** One-off helper (prefer {@link createBlockedHostMatcher} in hot paths). */
export const isBlockedHost = (host: string, blockedHosts: Iterable<string> = DEFAULT_BLOCKED_HOSTS): boolean => {
    return createBlockedHostMatcher(blockedHosts)(host);
};

/** Parses `||host^` EasyList rules and `0.0.0.0 host` hosts-file lines. */
export const parseEasyListHosts = (text: string): string[] => {
    if (typeof text !== "string" || !text) return [];

    const hosts = new Set<string>();
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("!") || line.startsWith("[")) continue;

        const match = EASYLIST_HOST_RE.exec(line) ?? HOSTS_FILE_RE.exec(line);
        const host = match ? normalizeAdblockHost(match[1]) : "";
        if (host && isValidHostname(host)) hosts.add(host);

        // Guard against pathological lists while still accepting real EasyList sizes.
        if (hosts.size >= 100_000) break;
    }

    return [...hosts].sort();
};

const hostnameOf = (value: string): string | null => {
    try {
        const parsed = new URL(value);
        return normalizeAdblockHost(parsed.hostname) || null;
    } catch {
        return null;
    }
};

/**
 * Decides whether the fallback may cancel a request.
 *
 * Main-frame navigation is always allowed so typing an ad/tracker domain in
 * the address bar still works. Path heuristics require a known third-party
 * referrer; curated/remote host entries apply to any subresource.
 */
export const shouldBlockRequest = (
    request: AdblockRequest,
    isHostBlocked: BlockedHostMatcher = DEFAULT_HOST_MATCHER,
): boolean => {
    if (!request || typeof request.url !== "string") return false;
    if (NAVIGATION_RESOURCE_TYPES.has((request.resourceType ?? "").toLowerCase())) return false;

    let parsed: URL;
    try {
        parsed = new URL(request.url);
    } catch {
        return false;
    }
    if (!HTTP_PROTOCOL_RE.test(parsed.protocol)) return false;

    const host = normalizeAdblockHost(parsed.hostname);
    if (!host) return false;
    if (isHostBlocked(host)) return true;

    const referrerHost = request.referrer ? hostnameOf(request.referrer) : null;
    if (!referrerHost || referrerHost === host) return false;

    return BLOCKED_PATH_PATTERNS.some((pattern) => pattern.test(parsed.pathname));
};

/** Convenience wrapper used by tests and simple callers. */
export const isBlockedUrl = (url: string, blockedHosts: Iterable<string> = DEFAULT_BLOCKED_HOSTS): boolean => {
    return shouldBlockRequest({ url, resourceType: "script" }, createBlockedHostMatcher(blockedHosts));
};
