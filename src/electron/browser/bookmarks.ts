import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BrowserBookmark } from "@common/types/browser";
import { DEFAULT_BOOKMARK_CATEGORY } from "@common/types/browser";
import { createMainLogger } from "@electron/util/logger";

const logger = createMainLogger("browser/bookmarks");

/** File under `userData` that stores browser bookmarks. */
export const BROWSER_BOOKMARKS_FILE = "browser-bookmarks.json";

const MAX_BOOKMARKS = 5_000;
const MAX_TITLE_LENGTH = 512;
const MAX_CATEGORY_LENGTH = 48;
const MAX_FAVICON_LENGTH = 2_048;

type StoredBookmarks = {
    version: 2;
    bookmarks: BrowserBookmark[];
};

export type AddBookmarkInput = {
    url: string;
    title?: string;
    favicon?: string;
    category?: string;
};

export type UpdateBookmarkInput = {
    title?: string;
    category?: string;
};

export type BookmarkStore = {
    list: () => BrowserBookmark[];
    add: (input: AddBookmarkInput) => BrowserBookmark | null;
    update: (id: string, input: UpdateBookmarkInput) => BrowserBookmark | null;
    remove: (id: string) => boolean;
};

/** Returns a canonical http(s) URL, or null when the input is not bookmarkable. */
export const normalizeBookmarkUrl = (value: string): string | null => {
    try {
        const parsed = new URL(value.trim());
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
        return parsed.href;
    } catch {
        return null;
    }
};

/** Trims user text and enforces a size limit. */
const cleanText = (value: unknown, fallback: string, maxLength: number): string => {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    const result = text || fallback;
    return result.length > maxLength ? result.slice(0, maxLength) : result;
};

/** Normalizes a user-visible category/folder name. */
const cleanCategory = (value: unknown): string => cleanText(value, DEFAULT_BOOKMARK_CATEGORY, MAX_CATEGORY_LENGTH);

/** Stores only network favicons; data URLs would bloat the JSON file. */
const cleanFavicon = (value: unknown): string => {
    if (typeof value !== "string") return "";
    const favicon = value.trim();
    if (favicon.length > MAX_FAVICON_LENGTH) return "";
    return /^https?:\/\//i.test(favicon) ? favicon : "";
};

const titleFallback = (url: string): string => {
    try {
        return new URL(url).hostname || url;
    } catch {
        return url;
    }
};

const normalizeRow = (value: unknown): BrowserBookmark | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<BrowserBookmark>;
    if (typeof row.url !== "string") return null;
    const url = normalizeBookmarkUrl(row.url);
    if (!url) return null;
    return {
        id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : randomUUID(),
        url,
        title: cleanText(row.title, titleFallback(url), MAX_TITLE_LENGTH),
        favicon: cleanFavicon(row.favicon),
        category: cleanCategory(row.category),
        createdAt:
            typeof row.createdAt === "number" && Number.isFinite(row.createdAt) && row.createdAt > 0
                ? row.createdAt
                : Date.now(),
    };
};

/**
 * Creates a bookmark store backed by one JSON file. The factory takes the file
 * path so tests can use a temporary directory without touching Electron paths.
 */
export const createBookmarkStore = (filePath: string): BookmarkStore => {
    let cached: BrowserBookmark[] | null = null;

    const read = (): BrowserBookmark[] => {
        if (cached) return cached;
        try {
            const raw = fs.readFileSync(filePath, "utf8");
            const parsed: unknown = JSON.parse(raw);
            const rows: unknown = Array.isArray(parsed)
                ? parsed
                : parsed && typeof parsed === "object"
                  ? (parsed as { bookmarks?: unknown }).bookmarks
                  : [];
            const list: BrowserBookmark[] = [];
            const seen = new Set<string>();
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const normalized = normalizeRow(row);
                    if (!normalized || seen.has(normalized.url)) continue;
                    seen.add(normalized.url);
                    list.push(normalized);
                    if (list.length >= MAX_BOOKMARKS) break;
                }
            }
            list.sort((left, right) => right.createdAt - left.createdAt);
            cached = list;
            return list;
        } catch (error) {
            cached = [];
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                logger.warn("could not read browser bookmarks; starting empty", error);
            }
            return cached;
        }
    };

    const write = (next: BrowserBookmark[]): void => {
        const payload: StoredBookmarks = { version: 2, bookmarks: next };
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const tempPath = `${filePath}.${process.pid}.tmp`;
        try {
            fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
            fs.renameSync(tempPath, filePath);
            cached = next;
        } catch (error) {
            try {
                fs.rmSync(tempPath, { force: true });
            } catch {
                // ignore temp cleanup failure
            }
            throw error;
        }
    };

    const list = (): BrowserBookmark[] => read().map((bookmark) => ({ ...bookmark }));

    const add = (input: AddBookmarkInput): BrowserBookmark | null => {
        const url = normalizeBookmarkUrl(input.url);
        if (!url) return null;
        const current = read();
        const existing = current.find((bookmark) => bookmark.url === url);
        if (existing) return { ...existing };
        if (current.length >= MAX_BOOKMARKS) return null;

        const bookmark: BrowserBookmark = {
            id: randomUUID(),
            url,
            title: cleanText(input.title, titleFallback(url), MAX_TITLE_LENGTH),
            favicon: cleanFavicon(input.favicon),
            category: cleanCategory(input.category),
            createdAt: Date.now(),
        };
        const next = [bookmark, ...current];
        try {
            write(next);
            return { ...bookmark };
        } catch (error) {
            logger.error("could not save browser bookmark", error);
            return null;
        }
    };

    const update = (id: string, input: UpdateBookmarkInput): BrowserBookmark | null => {
        const current = read();
        const index = current.findIndex((bookmark) => bookmark.id === id);
        if (index < 0) return null;
        const existing = current[index];
        const nextTitle = cleanText(input.title ?? existing.title, existing.title, MAX_TITLE_LENGTH);
        const nextCategory = cleanCategory(input.category ?? existing.category);
        if (nextTitle === existing.title && nextCategory === existing.category) return { ...existing };

        const updated: BrowserBookmark = {
            ...existing,
            title: nextTitle,
            category: nextCategory,
        };
        const next = current.map((bookmark, rowIndex) => (rowIndex === index ? updated : bookmark));
        try {
            write(next);
            return { ...updated };
        } catch (error) {
            logger.error("could not update browser bookmark", error);
            return null;
        }
    };

    const remove = (id: string): boolean => {
        const current = read();
        const next = current.filter((bookmark) => bookmark.id !== id);
        if (next.length === current.length) return false;
        try {
            write(next);
            return true;
        } catch (error) {
            logger.error("could not remove browser bookmark", error);
            return false;
        }
    };

    return { list, add, update, remove };
};
