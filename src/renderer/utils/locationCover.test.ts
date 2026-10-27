import { onInvoke, stubFs } from "@test/mocks/preload";
import { describe, expect, it, vi } from "vitest";
import { absolutePathToFileUrl, canonicalCoverAbsolutePath } from "./libraryCover";
import { indexLibraryItemsByLink, locationLinkKey, resolveLocationCoverSrc } from "./locationCover";

/**
 * Minimal catalogue row for cover resolution tests.
 */
const item = (overrides: Partial<Parameters<typeof indexLibraryItemsByLink>[0][string]> = {}) => ({
    id: 1,
    type: "manga" as const,
    link: window.path.resolve("library", "Over Flow Virus.zip"),
    cover: null,
    extra: {},
    ...overrides,
});

describe("locationLinkKey", () => {
    it("normalizes separators and path casing", () => {
        const link = window.path.resolve("library", "Series", "chapter.zip");
        expect(locationLinkKey(link)).toBe(process.platform === "win32" ? link.toLowerCase() : link);
    });
});

describe("indexLibraryItemsByLink", () => {
    it("maps rows by normalized link and ignores empty hashes", () => {
        const row = item();
        const index = indexLibraryItemsByLink({
            [row.link]: row,
            missing: null,
        });
        expect(index.get(locationLinkKey(row.link))).toBe(row);
        expect(index.size).toBe(1);
    });
});

describe("resolveLocationCoverSrc", () => {
    it("returns the existing library thumbnail before generating anything", async () => {
        const row = item({ id: 7, cover: window.path.resolve("covers", "custom.png") });
        stubFs({ isFile: (p) => p === window.path.normalize(row.cover as string) });

        await expect(resolveLocationCoverSrc(row.link, row, 1)).resolves.toBe(
            absolutePathToFileUrl(window.path.normalize(row.cover as string)),
        );
    });

    it("materializes a missing library thumbnail", async () => {
        const row = item({ id: 11 });
        const canonical = canonicalCoverAbsolutePath(11);
        let materialized = 0;
        let ready = false;
        onInvoke("covers:materializeFromLibraryPath", () => {
            materialized += 1;
            ready = true;
            return { ok: true };
        });
        stubFs({ isFile: (p) => ready && p === canonical });

        await expect(resolveLocationCoverSrc(row.link, row, 10)).resolves.toBe(absolutePathToFileUrl(canonical));
        expect(materialized).toBe(1);
    });

    it("falls back to a path-keyed preview and caches the invoke", async () => {
        const link = window.path.resolve("library", "Outside Catalogue.zip");
        const preview = window.path.resolve("userData", "covers", "preview", "a.webp");
        const invoke = vi.fn(async () => ({ ok: true as const, filePath: preview }));
        onInvoke("covers:previewForPath", invoke);
        stubFs({ isFile: (p) => p === link });

        await expect(resolveLocationCoverSrc(link, null, 99)).resolves.toBe(absolutePathToFileUrl(preview));
        await expect(resolveLocationCoverSrc(link, null, 99)).resolves.toBe(absolutePathToFileUrl(preview));
        expect(invoke).toHaveBeenCalledTimes(1);
    });
});
