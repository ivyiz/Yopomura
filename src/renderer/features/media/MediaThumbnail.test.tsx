import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import MediaThumbnail from "./MediaThumbnail";
import { MAX_CACHED_THUMBNAILS, resetThumbnailBudget, retainThumbnail } from "./thumbnailBudget";

class MockIntersectionObserver {
    static instances: MockIntersectionObserver[] = [];
    private readonly elements: Element[] = [];

    constructor(private readonly callback: IntersectionObserverCallback) {
        MockIntersectionObserver.instances.push(this);
    }

    observe(element: Element) {
        this.elements.push(element);
    }

    disconnect() {
        /* nothing to clean up in the mock */
    }

    unobserve() {
        /* nothing to clean up in the mock */
    }

    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }

    trigger(isIntersecting: boolean) {
        const entries = this.elements.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry);
        this.callback(entries, this as unknown as IntersectionObserver);
    }
}

const currentObserver = (): MockIntersectionObserver => {
    const observer = MockIntersectionObserver.instances.at(-1);
    if (!observer) throw new Error("IntersectionObserver was not created");
    return observer;
};

describe("MediaThumbnail", () => {
    beforeEach(() => {
        MockIntersectionObserver.instances = [];
        resetThumbnailBudget();
        Object.defineProperty(globalThis, "IntersectionObserver", {
            configurable: true,
            writable: true,
            value: MockIntersectionObserver,
        });
    });

    it("keeps the same video element when it scrolls out and back in", () => {
        render(<MediaThumbnail path={"C:\\Shows\\Ep1.mp4"} />);
        const observer = currentObserver();

        act(() => observer.trigger(true));
        const first = document.querySelector("video");
        expect(first).not.toBeNull();
        expect(first?.getAttribute("src")).toContain("Ep1.mp4");

        act(() => observer.trigger(false));
        const stillMounted = document.querySelector("video");
        expect(stillMounted).toBe(first);
        expect(stillMounted?.getAttribute("src")).toBe(first?.getAttribute("src"));

        act(() => observer.trigger(true));
        expect(document.querySelector("video")).toBe(first);
    });

    it("drops the video only when the shared budget evicts it", () => {
        render(<MediaThumbnail path={"C:\\Shows\\Ep2.mp4"} />);
        const observer = currentObserver();

        act(() => observer.trigger(true));
        expect(document.querySelector("video")).not.toBeNull();

        act(() => {
            for (let index = 0; index < MAX_CACHED_THUMBNAILS; index += 1) {
                retainThumbnail(`other-${index}`);
            }
        });

        expect(document.querySelector("video")).toBeNull();
    });
});
