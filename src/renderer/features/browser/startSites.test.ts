import { describe, expect, it } from "vitest";
import { BROWSER_START_SITES, browserStartHosts } from "./startSites";

describe("browser start sites", () => {
    it("ships neutral defaults", () => {
        expect(BROWSER_START_SITES.filter((site) => site.category === "reading")).toHaveLength(4);
        expect(BROWSER_START_SITES.filter((site) => site.category === "media")).toHaveLength(2);
        expect(BROWSER_START_SITES.filter((site) => site.category === "tools")).toHaveLength(2);
        expect(BROWSER_START_SITES).toHaveLength(8);
    });

    it("uses unique ids/domains and https URLs", () => {
        expect(new Set(BROWSER_START_SITES.map((site) => site.id)).size).toBe(BROWSER_START_SITES.length);
        expect(new Set(BROWSER_START_SITES.map((site) => site.domain)).size).toBe(BROWSER_START_SITES.length);
        for (const site of BROWSER_START_SITES) {
            expect(site.url.startsWith("https://")).toBe(true);
            expect(site.url).toContain(site.domain);
        }
    });

    it("returns every host once for icon prefetching", () => {
        const hosts = browserStartHosts();
        expect(hosts).toHaveLength(BROWSER_START_SITES.length);
        expect(new Set(hosts).size).toBe(hosts.length);
        expect(hosts).toContain("wikipedia.org");
        expect(hosts).toContain("github.com");
    });
});
