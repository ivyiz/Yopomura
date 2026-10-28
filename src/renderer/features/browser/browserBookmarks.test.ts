import type { BrowserBookmark } from "@common/types/browser";
import { describe, expect, it } from "vitest";
import {
    bookmarkCategories,
    canonicalCategoryName,
    cleanCategoryName,
    groupBookmarksByCategory,
    readLastBookmarkCategory,
    saveLastBookmarkCategory,
} from "./browserBookmarks";

const bookmark = (id: string, category: string, createdAt: number): BrowserBookmark => ({
    id,
    url: `https://example.com/${id}`,
    title: id,
    favicon: "",
    category,
    createdAt,
});

describe("browser bookmark categories", () => {
    it("normalizes category names", () => {
        expect(cleanCategoryName("  My   research  ")).toBe("My research");
        expect(cleanCategoryName("   ")).toBe("Favorites");
        expect(cleanCategoryName("x".repeat(80))).toHaveLength(48);
    });

    it("reuses an existing category case-insensitively", () => {
        expect(canonicalCategoryName("tools", ["Favorites", "Tools"])).toBe("Tools");
        expect(canonicalCategoryName("New", ["Favorites", "Tools"])).toBe("New");
    });

    it("lists Favorites first and then categories by first bookmark", () => {
        const bookmarks = [
            bookmark("a", "Research", 300),
            bookmark("b", "Favorites", 400),
            bookmark("c", "Tools", 200),
        ];
        expect(bookmarkCategories(bookmarks)).toEqual(["Favorites", "Tools", "Research"]);
    });

    it("groups non-empty categories and keeps newest first", () => {
        const groups = groupBookmarksByCategory([
            bookmark("old", "Research", 100),
            bookmark("new", "Research", 300),
            bookmark("fav", "Favorites", 200),
        ]);
        expect(groups.map((group) => group.category)).toEqual(["Favorites", "Research"]);
        expect(groups[1]?.bookmarks.map((row) => row.id)).toEqual(["new", "old"]);
    });

    it("drops empty categories", () => {
        const groups = groupBookmarksByCategory([bookmark("fav", "Favorites", 100)]);
        expect(groups).toHaveLength(1);
    });

    it("persists the last used category", () => {
        const values = new Map<string, string>();
        const storage = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => {
                values.set(key, value);
            },
        };
        expect(readLastBookmarkCategory(storage)).toBe("Favorites");
        saveLastBookmarkCategory("Research", storage);
        expect(readLastBookmarkCategory(storage)).toBe("Research");
    });
});
