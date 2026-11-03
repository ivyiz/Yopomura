import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    isThumbnailCached,
    MAX_CACHED_THUMBNAILS,
    releaseThumbnail,
    resetThumbnailBudget,
    retainThumbnail,
    setThumbnailVisible,
    subscribeThumbnail,
} from "./thumbnailBudget";

describe("thumbnail budget", () => {
    beforeEach(() => {
        resetThumbnailBudget();
    });

    it("keeps thumbnails cached until the budget overflows", () => {
        for (let index = 0; index < MAX_CACHED_THUMBNAILS; index += 1) {
            retainThumbnail(`thumb-${index}`);
        }
        expect(isThumbnailCached("thumb-0")).toBe(true);

        retainThumbnail("thumb-overflow");

        expect(isThumbnailCached("thumb-0")).toBe(false);
        expect(isThumbnailCached("thumb-1")).toBe(true);
        expect(isThumbnailCached("thumb-overflow")).toBe(true);
    });

    it("notifies the evicted thumbnail so it can drop its video element", () => {
        for (let index = 0; index < MAX_CACHED_THUMBNAILS; index += 1) {
            retainThumbnail(`thumb-${index}`);
        }
        const listener = vi.fn();
        subscribeThumbnail("thumb-0", listener);

        retainThumbnail("thumb-new");

        expect(listener).toHaveBeenCalledTimes(1);
        expect(isThumbnailCached("thumb-0")).toBe(false);
    });

    it("re-retains an evicted thumbnail when it becomes visible again", () => {
        for (let index = 0; index < MAX_CACHED_THUMBNAILS; index += 1) {
            retainThumbnail(`thumb-${index}`);
        }
        retainThumbnail("thumb-new");
        expect(isThumbnailCached("thumb-0")).toBe(false);

        retainThumbnail("thumb-0");

        expect(isThumbnailCached("thumb-0")).toBe(true);
        expect(isThumbnailCached("thumb-1")).toBe(false);
    });

    it("skips visible thumbnails when an offscreen candidate exists", () => {
        retainThumbnail("offscreen");
        setThumbnailVisible("offscreen", false);
        for (let index = 0; index < MAX_CACHED_THUMBNAILS - 1; index += 1) {
            retainThumbnail(`thumb-${index}`);
        }

        retainThumbnail("thumb-new");

        expect(isThumbnailCached("offscreen")).toBe(false);
        expect(isThumbnailCached("thumb-0")).toBe(true);
    });

    it("releases a thumbnail when its component unmounts", () => {
        retainThumbnail("thumb-a");
        releaseThumbnail("thumb-a");

        expect(isThumbnailCached("thumb-a")).toBe(false);

        /* A released id no longer takes space in the budget. */
        for (let index = 0; index < MAX_CACHED_THUMBNAILS; index += 1) {
            retainThumbnail(`thumb-${index}`);
        }
        expect(isThumbnailCached("thumb-0")).toBe(true);
    });
});
