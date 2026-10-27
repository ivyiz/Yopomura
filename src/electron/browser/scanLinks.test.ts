import { describe, expect, it } from "vitest";
import { MAX_SCANNED_LINKS, normalizeLinkText, normalizeScannedLinks, resolveScannedUrl } from "./scanLinks";

describe("normalizeLinkText", () => {
    it("trims and collapses page whitespace", () => {
        expect(normalizeLinkText("  Hello\n\tworld  ")).toBe("Hello world");
        expect(normalizeLinkText("A   B")).toBe("A B");
    });

    it("returns an empty string for non-strings", () => {
        expect(normalizeLinkText(undefined)).toBe("");
        expect(normalizeLinkText(42)).toBe("");
        expect(normalizeLinkText(null)).toBe("");
    });
});

describe("resolveScannedUrl", () => {
    it("resolves relative hrefs against the page URL", () => {
        expect(resolveScannedUrl("/chapter/2", "https://example.com/manga/1")).toBe(
            "https://example.com/chapter/2",
        );
        expect(resolveScannedUrl("next.html", "https://example.com/manga/1")).toBe(
            "https://example.com/manga/next.html",
        );
        expect(resolveScannedUrl("//cdn.example.com/x", "https://example.com/")).toBe("https://cdn.example.com/x");
    });

    it("keeps absolute http and https URLs", () => {
        expect(resolveScannedUrl("http://example.com/a", "https://example.com/")).toBe("http://example.com/a");
        expect(resolveScannedUrl("https://example.com/a?b=1#c", "https://example.com/")).toBe(
            "https://example.com/a?b=1#c",
        );
    });

    it("rejects non-http(s) and malformed hrefs", () => {
        expect(resolveScannedUrl("javascript:alert(1)", "https://example.com/")).toBeNull();
        expect(resolveScannedUrl("mailto:a@example.com", "https://example.com/")).toBeNull();
        expect(resolveScannedUrl("data:text/html,hi", "https://example.com/")).toBeNull();
        expect(resolveScannedUrl("", "https://example.com/")).toBeNull();
        expect(resolveScannedUrl(null, "https://example.com/")).toBeNull();
    });
});

describe("normalizeScannedLinks", () => {
    const base = "https://example.com/page";

    it("normalizes text, resolves URLs, and deduplicates by URL", () => {
        const links = normalizeScannedLinks(
            [
                { href: "/b", text: "  Second\nlink " },
                { href: "https://example.com/b", text: "Duplicate" },
                { href: "/a", text: "First" },
            ],
            base,
        );

        expect(links).toEqual([
            { url: "https://example.com/a", text: "First" },
            { url: "https://example.com/b", text: "Second link" },
        ]);
    });

    it("sorts by text and then URL", () => {
        const links = normalizeScannedLinks(
            [
                { href: "/z", text: "Same" },
                { href: "/a", text: "Same" },
                { href: "/x", text: "alpha" },
                { href: "/y", text: "" },
            ],
            base,
        );

        expect(links.map((link) => link.url)).toEqual([
            "https://example.com/y",
            "https://example.com/x",
            "https://example.com/a",
            "https://example.com/z",
        ]);
    });

    it("drops invalid rows and caps the result", () => {
        const rows: Array<{ href: string; text: string }> = [];
        for (let index = 0; index < MAX_SCANNED_LINKS + 50; index++) {
            rows.push({ href: `/link-${index}`, text: `Link ${index}` });
        }
        rows.push({ href: "mailto:x@example.com", text: "Mail" });
        rows.push({ href: "/link-0", text: "Duplicate" });

        const links = normalizeScannedLinks(rows, base);
        expect(links).toHaveLength(MAX_SCANNED_LINKS);
        expect(links.every((link) => link.url.startsWith("https://example.com/link-"))).toBe(true);
    });

    it("returns an empty array for non-array input", () => {
        expect(normalizeScannedLinks(null, base)).toEqual([]);
        expect(normalizeScannedLinks({ href: "/a" }, base)).toEqual([]);
    });

    it("accepts already-resolved rows that use `url` instead of `href`", () => {
        expect(normalizeScannedLinks([{ url: "https://example.com/one", text: "One" }], base)).toEqual([
            { url: "https://example.com/one", text: "One" },
        ]);
    });
});
