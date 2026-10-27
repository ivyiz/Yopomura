/**
 * Pure helpers for the integrated browser's link scanner.
 *
 * Electron is intentionally not imported here so the normalization rules can be
 * unit tested in a plain Node environment. `BrowserManager.scanLinks` runs a
 * small page script that returns raw `{ href, text }` rows and hands them to
 * {@link normalizeScannedLinks}.
 */

import type { BrowserScannedLink } from "@common/types/browser";

/** Maximum number of links returned to the renderer per scan. */
export const MAX_SCANNED_LINKS = 500;

const HTTP_PROTOCOL_RE = /^https?:$/i;
const WHITESPACE_RE = /\s+/g;

/** Collapses page whitespace and trims link text (may be empty for icon links). */
export const normalizeLinkText = (text: unknown): string => {
    if (typeof text !== "string") return "";
    return text.replace(WHITESPACE_RE, " ").trim();
};

/**
 * Resolves an anchor href against `baseUrl` and keeps only absolute http(s)
 * URLs. Returns `null` for javascript:, mailto:, data:, malformed input, etc.
 */
export const resolveScannedUrl = (href: unknown, baseUrl: string): string | null => {
    if (typeof href !== "string") return null;
    const value = href.trim();
    if (!value) return null;

    try {
        const parsed = new URL(value, baseUrl || undefined);
        if (!HTTP_PROTOCOL_RE.test(parsed.protocol)) return null;
        if (!parsed.hostname) return null;
        return parsed.href;
    } catch {
        return null;
    }
};

/**
 * Normalizes the raw rows injected by the page script:
 * - resolves/validates http(s) URLs,
 * - trims and collapses anchor text,
 * - deduplicates by URL (first occurrence wins),
 * - sorts by text, then URL,
 * - caps the result at `limit`.
 */
export const normalizeScannedLinks = (
    raw: unknown,
    baseUrl: string,
    limit = MAX_SCANNED_LINKS,
): BrowserScannedLink[] => {
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const links: BrowserScannedLink[] = [];

    for (const row of raw) {
        if (!row || typeof row !== "object") continue;
        const record = row as { href?: unknown; url?: unknown; text?: unknown };
        const url = resolveScannedUrl(record.href ?? record.url, baseUrl);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        links.push({ url, text: normalizeLinkText(record.text) });
    }

    links.sort((left, right) => {
        const byText = left.text.localeCompare(right.text, "en", { sensitivity: "base" });
        if (byText !== 0) return byText;
        return left.url.localeCompare(right.url, "en");
    });

    return links.slice(0, Math.max(0, limit));
};
