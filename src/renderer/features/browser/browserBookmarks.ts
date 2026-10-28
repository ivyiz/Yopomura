import type { BrowserBookmark } from "@common/types/browser";
import { DEFAULT_BOOKMARK_CATEGORY } from "@common/types/browser";

const LAST_CATEGORY_KEY = "yopomura-browser-last-bookmark-category";
const MAX_CATEGORY_LENGTH = 48;

/** Trims and collapses a category name, keeping the default when empty. */
export const cleanCategoryName = (value: string): string => {
    const text = value.replace(/\s+/g, " ").trim();
    if (!text) return DEFAULT_BOOKMARK_CATEGORY;
    return text.slice(0, MAX_CATEGORY_LENGTH);
};

/** Reuses an existing category with the same case-insensitive name. */
export const canonicalCategoryName = (value: string, categories: readonly string[]): string => {
    const cleaned = cleanCategoryName(value);
    const existing = categories.find((category) => category.toLowerCase() === cleaned.toLowerCase());
    return existing ?? cleaned;
};

export type BookmarkCategoryGroup = {
    category: string;
    bookmarks: BrowserBookmark[];
};

/** Unique categories, Favorites first, then by the first bookmark created. */
export const bookmarkCategories = (bookmarks: readonly BrowserBookmark[]): string[] => {
    const firstSeen = new Map<string, { label: string; createdAt: number }>();
    for (const bookmark of bookmarks) {
        const label = cleanCategoryName(bookmark.category);
        const key = label.toLowerCase();
        const current = firstSeen.get(key);
        if (!current || bookmark.createdAt < current.createdAt) {
            firstSeen.set(key, { label, createdAt: bookmark.createdAt });
        }
    }
    if (!firstSeen.has(DEFAULT_BOOKMARK_CATEGORY.toLowerCase())) {
        firstSeen.set(DEFAULT_BOOKMARK_CATEGORY.toLowerCase(), {
            label: DEFAULT_BOOKMARK_CATEGORY,
            createdAt: Number.MAX_SAFE_INTEGER,
        });
    }

    return [...firstSeen.values()]
        .sort((left, right) => {
            const leftDefault = left.label === DEFAULT_BOOKMARK_CATEGORY;
            const rightDefault = right.label === DEFAULT_BOOKMARK_CATEGORY;
            if (leftDefault !== rightDefault) return leftDefault ? -1 : 1;
            if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
            return left.label.localeCompare(right.label);
        })
        .map((entry) => entry.label);
};

/** Groups bookmarks into display sections; empty categories are omitted. */
export const groupBookmarksByCategory = (bookmarks: readonly BrowserBookmark[]): BookmarkCategoryGroup[] => {
    const categories = bookmarkCategories(bookmarks);
    const groups: BookmarkCategoryGroup[] = [];
    for (const category of categories) {
        const rows = bookmarks
            .filter((bookmark) => cleanCategoryName(bookmark.category).toLowerCase() === category.toLowerCase())
            .sort((left, right) => right.createdAt - left.createdAt);
        if (rows.length > 0) groups.push({ category, bookmarks: rows });
    }
    return groups;
};

export const readLastBookmarkCategory = (storage: Pick<Storage, "getItem"> = window.localStorage): string => {
    try {
        return cleanCategoryName(storage.getItem(LAST_CATEGORY_KEY) ?? DEFAULT_BOOKMARK_CATEGORY);
    } catch {
        return DEFAULT_BOOKMARK_CATEGORY;
    }
};

export const saveLastBookmarkCategory = (
    category: string,
    storage: Pick<Storage, "setItem"> = window.localStorage,
): void => {
    try {
        storage.setItem(LAST_CATEGORY_KEY, cleanCategoryName(category));
    } catch {
        // localStorage can be unavailable; the bookmark itself is still saved.
    }
};
