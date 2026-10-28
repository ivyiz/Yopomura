import { describe, expect, it } from "vitest";
import { BROWSER_START_SITES, browserStartHosts } from "./startSites";

describe("browser start sites", () => {
    it("contains the five downloader manga sites and three video sites", () => {
        expect(BROWSER_START_SITES.filter((site) => site.category === "manga")).toHaveLength(5);
        expect(BROWSER_START_SITES.filter((site) => site.category === "video")).toHaveLength(3);
        expect(BROWSER_START_SITES).toHaveLength(8);
    });

    it("marks every manga site as downloader-supported and no video site", () => {
        for (const site of BROWSER_START_SITES) {
            if (site.category === "manga") expect(site.downloaderSupported).toBe(true);
            else expect(site.downloaderSupported).toBeFalsy();
        }
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
        expect(hosts).toContain("hanime.tv");
        expect(hosts).toContain("hentaihaven.xxx");
    });
});
