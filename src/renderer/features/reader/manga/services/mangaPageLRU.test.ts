import { describe, expect, it, vi } from "vitest";
import { MangaPageLRUCache } from "./mangaPageLRU";

describe("MangaPageLRUCache", () => {
    it("clamps capacity to range [20, 200]", () => {
        const cacheLow = new MangaPageLRUCache({ maxCapacity: 10 });
        expect(cacheLow.getMaxCapacity()).toBe(20);

        const cacheHigh = new MangaPageLRUCache({ maxCapacity: 300 });
        expect(cacheHigh.getMaxCapacity()).toBe(200);

        const cacheNormal = new MangaPageLRUCache({ maxCapacity: 50 });
        expect(cacheNormal.getMaxCapacity()).toBe(50);
    });

    it("tracks cached pages and access order", () => {
        const cache = new MangaPageLRUCache({ maxCapacity: 20 });
        for (let i = 0; i < 20; i++) {
            cache.touch(i);
        }
        expect(cache.getCachedCount()).toBe(20);
        expect(cache.isCached(0)).toBe(true);
        expect(cache.isCached(19)).toBe(true);
    });

    it("evicts least recently used page when capacity is exceeded", () => {
        const evicted: number[] = [];
        const cache = new MangaPageLRUCache({
            maxCapacity: 20,
            onEvict: (pageIndex) => evicted.push(pageIndex),
        });

        for (let i = 0; i < 20; i++) {
            cache.touch(i);
        }
        expect(evicted).toHaveLength(0);

        // Page 0 was accessed first, touching page 20 should evict page 0
        cache.touch(20);
        expect(cache.getCachedCount()).toBe(20);
        expect(cache.isCached(0)).toBe(false);
        expect(cache.isCached(20)).toBe(true);
        expect(evicted).toEqual([0]);
    });

    it("preserves recently touched page over older untouched page", () => {
        const evicted: number[] = [];
        const cache = new MangaPageLRUCache({
            maxCapacity: 20,
            onEvict: (pageIndex) => evicted.push(pageIndex),
        });

        for (let i = 0; i < 20; i++) {
            cache.touch(i);
        }

        // Touch page 0 again to make it most recently used
        cache.touch(0);

        // Now touch page 20: page 1 should be evicted, not page 0
        cache.touch(20);
        expect(cache.isCached(0)).toBe(true);
        expect(cache.isCached(1)).toBe(false);
        expect(evicted).toEqual([1]);
    });

    it("skips visible pages during eviction when an offscreen candidate exists", () => {
        const evicted: number[] = [];
        const cache = new MangaPageLRUCache({
            maxCapacity: 20,
            onEvict: (pageIndex) => evicted.push(pageIndex),
        });

        for (let i = 0; i < 20; i++) {
            cache.touch(i);
        }

        // Mark page 0 as currently visible in viewport
        cache.setVisible(0, true);

        // Touch page 20: page 0 is visible, so page 1 should be evicted instead
        cache.touch(20);
        expect(cache.isCached(0)).toBe(true);
        expect(cache.isCached(1)).toBe(false);
        expect(evicted).toEqual([1]);
    });

    it("calls onReload when an evicted page is touched again", () => {
        const reloaded: number[] = [];
        const cache = new MangaPageLRUCache({
            maxCapacity: 20,
            onReload: (pageIndex) => reloaded.push(pageIndex),
        });

        for (let i = 0; i < 21; i++) {
            cache.touch(i);
        }
        // Page 0 was evicted
        expect(cache.isCached(0)).toBe(false);
        expect(reloaded).toHaveLength(0);

        // Scroll back to page 0
        cache.touch(0);
        expect(cache.isCached(0)).toBe(true);
        expect(reloaded).toEqual([0]);
    });

    it("evicts excess pages when max capacity is dynamically reduced", () => {
        const evicted: number[] = [];
        const cache = new MangaPageLRUCache({
            maxCapacity: 30,
            onEvict: (pageIndex) => evicted.push(pageIndex),
        });

        for (let i = 0; i < 30; i++) {
            cache.touch(i);
        }
        expect(cache.getCachedCount()).toBe(30);

        // Reduce capacity to 20
        cache.setMaxCapacity(20);
        expect(cache.getCachedCount()).toBe(20);
        expect(evicted).toHaveLength(10);
        expect(evicted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it("clears all tracking on clear()", () => {
        const cache = new MangaPageLRUCache({ maxCapacity: 20 });
        for (let i = 0; i < 10; i++) {
            cache.touch(i);
            cache.setVisible(i, true);
        }
        cache.clear();
        expect(cache.getCachedCount()).toBe(0);
        expect(cache.isCached(0)).toBe(false);
        expect(cache.isVisible(0)).toBe(false);
    });
});
