/**
 * URL, search-engine, and force-dark host helpers for the in-app browser.
 *
 * This module is intentionally free of Electron imports so it can be unit
 * tested in a plain Node environment. `BrowserManager` is the only consumer.
 */

export type BrowserSearchEngine = "brave" | "google" | "duckduckgo";

export type BrowserInputKind = "url" | "search";

export interface BrowserInputResolution {
    kind: BrowserInputKind;
    /** Absolute http(s) URL (or the search URL when `kind` is `search`). */
    url: string;
    /** Present only for search resolutions. */
    query?: string;
    /** Present only for search resolutions. */
    engine?: BrowserSearchEngine;
}

export const DEFAULT_SEARCH_ENGINE: BrowserSearchEngine = "brave";

const SEARCH_ENGINE_BUILDERS: Record<BrowserSearchEngine, (query: string) => string> = {
    brave: (query) => `https://search.brave.com/search?q=${encodeURIComponent(query)}&safesearch=off`,
    google: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}&safe=off`,
    duckduckgo: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}&kp=-2`,
};

const HTTP_PROTOCOL_RE = /^https?:$/i;
const EXPLICIT_HTTP_URL_RE = /^https?:\/\//i;
const EXPLICIT_HTTP_SCHEME_RE = /^https?:/i;
const ANY_SCHEME_WITH_SLASHES_RE = /^[a-z][a-z\d+.-]*:\/\//i;
const NON_WEB_SCHEME_RE =
    /^(?:about|blob|chrome|chrome-extension|data|file|ftp|ftps|javascript|mailto|tel|urn|view-source):/i;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const PARTIAL_IP_RE = /^\d{1,3}(?:\.\d{1,3}){1,2}$/;
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/**
 * A hostname is only treated as a real site when it cannot be confused with a
 * single search word. Single labels (`github`), version strings (`1.2.3`) and
 * malformed IPs (`999.1.1.1`) therefore fall through to search.
 */
const isAcceptableHostname = (hostname: string): boolean => {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    if (!host) return false;

    if (host === "localhost" || host.endsWith(".localhost")) return true;

    // IPv6 literals keep their brackets in WHATWG URL hostnames.
    if (host.startsWith("[") && host.endsWith("]")) return true;

    if (IPV4_RE.test(host)) {
        return host.split(".").every((part) => Number(part) <= 255);
    }

    const labels = host.split(".");
    if (labels.length < 2) return false;
    if (labels.some((label) => !label || label.length > 63 || !HOST_LABEL_RE.test(label))) return false;

    const tld = labels[labels.length - 1];
    return tld.length >= 2 && /[a-z]/i.test(tld);
};

/**
 * Normalizes user input that already looks like a URL into an absolute
 * http(s) URL. Returns `null` when the input is a search phrase, an unsupported
 * scheme, or otherwise not a valid web host.
 */
export const normalizeUrl = (input: string): string | null => {
    const value = input.trim();
    if (!value) return null;
    // WHATWG URL expands `1.2.3` to an IP shorthand; treat version-like input as a search instead.
    if (PARTIAL_IP_RE.test(value)) return null;
    if (NON_WEB_SCHEME_RE.test(value)) return null;
    if (ANY_SCHEME_WITH_SLASHES_RE.test(value) && !EXPLICIT_HTTP_URL_RE.test(value)) return null;

    let candidate: string;
    if (EXPLICIT_HTTP_SCHEME_RE.test(value)) {
        candidate = value;
    } else if (value.startsWith("//")) {
        candidate = `https:${value}`;
    } else {
        candidate = `https://${value}`;
    }

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return null;
    }

    if (!HTTP_PROTOCOL_RE.test(parsed.protocol)) return null;
    if (!parsed.hostname || !isAcceptableHostname(parsed.hostname)) return null;

    return parsed.toString();
};

/** True when the value is an absolute http(s) URL and safe to load in a tab. */
export const isAllowedBrowserUrl = (value: string): boolean => {
    try {
        const parsed = new URL(value);
        return HTTP_PROTOCOL_RE.test(parsed.protocol) && Boolean(parsed.hostname);
    } catch {
        return false;
    }
};

/** Builds a search URL for the given engine (query is percent-encoded). */
export const buildSearchUrl = (query: string, engine: BrowserSearchEngine = DEFAULT_SEARCH_ENGINE): string => {
    return SEARCH_ENGINE_BUILDERS[engine](query.trim());
};

export const isSearchEngine = (value: string): value is BrowserSearchEngine => {
    return value === "brave" || value === "google" || value === "duckduckgo";
};

/**
 * Resolves omnibox-style input: valid URLs are normalized to https when the
 * scheme is omitted, everything else becomes a search query.
 */
export const resolveBrowserInput = (
    input: string,
    engine: BrowserSearchEngine = DEFAULT_SEARCH_ENGINE,
): BrowserInputResolution | null => {
    const value = input.trim();
    if (!value) return null;

    const normalized = normalizeUrl(value);
    if (normalized) return { kind: "url", url: normalized };

    return {
        kind: "search",
        url: buildSearchUrl(value, engine),
        query: value,
        engine,
    };
};

/** Lowercases a host and drops a single trailing dot. */
export const normalizeHost = (host: string): string => {
    return host.trim().toLowerCase().replace(/\.$/, "");
};

/**
 * Extracts the hostname from a URL or bare host input. Returns `null` for
 * unsupported schemes or malformed input.
 */
export const getHostname = (value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    let candidate: string;
    if (EXPLICIT_HTTP_SCHEME_RE.test(trimmed)) {
        candidate = trimmed;
    } else if (ANY_SCHEME_WITH_SLASHES_RE.test(trimmed)) {
        candidate = trimmed;
    } else if (trimmed.startsWith("//")) {
        candidate = `https:${trimmed}`;
    } else {
        if (NON_WEB_SCHEME_RE.test(trimmed)) return null;
        candidate = `https://${trimmed}`;
    }

    try {
        const parsed = new URL(candidate);
        const host = normalizeHost(parsed.hostname);
        return host || null;
    } catch {
        return null;
    }
};

/**
 * True when `host` equals `domain` or is a subdomain of it. IP literals must
 * match exactly so `168.1.1` cannot match `192.168.1.1`.
 */
export const hostMatchesDomain = (host: string, domain: string): boolean => {
    const normalizedHost = normalizeHost(host);
    const normalizedDomain = normalizeHost(domain);
    if (!normalizedHost || !normalizedDomain) return false;

    if (IPV4_RE.test(normalizedHost) || normalizedHost.startsWith("[")) {
        return normalizedHost === normalizedDomain;
    }
    if (IPV4_RE.test(normalizedDomain) || normalizedDomain.startsWith("[")) {
        return false;
    }

    return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
};

/** True when the URL's host is covered by any entry in `disabledHosts`. */
export const isHostDisabled = (urlOrHost: string, disabledHosts: Iterable<string>): boolean => {
    const host = getHostname(urlOrHost);
    if (!host) return false;

    for (const disabled of disabledHosts) {
        if (hostMatchesDomain(host, disabled)) return true;
    }
    return false;
};

/**
 * Force-dark is global but can be disabled per host (subdomains included).
 * `about:blank` and other host-less documents follow the global setting.
 */
export const shouldForceDarkForUrl = (
    url: string,
    forceDark: boolean,
    disabledHosts: Iterable<string>,
): boolean => {
    if (!forceDark) return false;
    if (!getHostname(url)) return true;
    return !isHostDisabled(url, disabledHosts);
};
