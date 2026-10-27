import { describe, expect, it } from "vitest";
import {
    createBlockedHostMatcher,
    DEFAULT_BLOCKED_HOSTS,
    isBlockedHost,
    isBlockedUrl,
    normalizeAdblockHost,
    parseEasyListHosts,
    shouldBlockRequest,
} from "./adblockFallback";

describe("normalizeAdblockHost", () => {
    it("lowercases and drops a trailing dot", () => {
        expect(normalizeAdblockHost("  Ads.Example.COM. ")).toBe("ads.example.com");
    });
});

describe("createBlockedHostMatcher / isBlockedHost", () => {
    const isBlocked = createBlockedHostMatcher(DEFAULT_BLOCKED_HOSTS);

    it("matches exact hosts and subdomains", () => {
        expect(isBlocked("doubleclick.net")).toBe(true);
        expect(isBlocked("ads.g.doubleclick.net")).toBe(true);
        expect(isBlocked("sub.unityads.unity3d.com")).toBe(true);
    });

    it("does not match lookalike suffixes or unrelated hosts", () => {
        expect(isBlocked("notdoubleclick.net")).toBe(false);
        expect(isBlocked("doubleclick.net.example.com")).toBe(false);
        expect(isBlocked("example.com")).toBe(false);
        expect(isBlocked("")).toBe(false);
    });

    it("never blocks localhost or IP literals through domain entries", () => {
        expect(isBlocked("localhost")).toBe(false);
        expect(isBlocked("app.localhost")).toBe(false);
        expect(isBlocked("127.0.0.1")).toBe(false);
        expect(isBlockedHost("doubleclick.net")).toBe(true);
        expect(isBlockedHost("example.com", ["EXAMPLE.com"])).toBe(true);
    });
});

describe("parseEasyListHosts", () => {
    it("extracts ||host^ rules and hosts-file entries, skipping comments and paths", () => {
        const list = [
            "! Title: EasyList",
            "[Adblock Plus 2.0]",
            "||doubleclick.net^",
            "||Ads.Example.COM^",
            "||example.com/path^",
            "||pathrule.example^$third-party",
            "0.0.0.0 tracker.test",
            "127.0.0.1 metrics.test # comment",
            "||not_a_host^",
        ].join("\n");

        expect(parseEasyListHosts(list)).toEqual([
            "ads.example.com",
            "doubleclick.net",
            "metrics.test",
            "pathrule.example",
            "tracker.test",
        ]);
    });

    it("returns an empty array for empty or non-string input", () => {
        expect(parseEasyListHosts("")).toEqual([]);
        expect(parseEasyListHosts(undefined as unknown as string)).toEqual([]);
    });
});

describe("shouldBlockRequest", () => {
    it("blocks third-party ad/tracker hosts", () => {
        expect(
            shouldBlockRequest({
                url: "https://ads.g.doubleclick.net/pixel.gif",
                resourceType: "image",
                referrer: "https://example.com/article",
            }),
        ).toBe(true);
    });

    it("never blocks main-frame navigation, even to a blocked host", () => {
        expect(
            shouldBlockRequest({
                url: "https://doubleclick.net/",
                resourceType: "mainFrame",
                referrer: "https://example.com/",
            }),
        ).toBe(false);
    });

    it("allows same-origin resources and their path heuristics", () => {
        expect(
            shouldBlockRequest({
                url: "https://example.com/ads/banner.png",
                resourceType: "image",
                referrer: "https://example.com/article",
            }),
        ).toBe(false);
        expect(
            shouldBlockRequest({
                url: "https://example.com/pagead/slot.js",
                resourceType: "script",
                referrer: "https://example.com/article",
            }),
        ).toBe(false);
    });

    it("applies path heuristics only to third-party subresources", () => {
        expect(
            shouldBlockRequest({
                url: "https://cdn.example.org/ads/banner.png",
                resourceType: "script",
                referrer: "https://example.com/article",
            }),
        ).toBe(true);
        expect(
            shouldBlockRequest({
                url: "https://cdn.example.org/ads/banner.png",
                resourceType: "script",
                referrer: "",
            }),
        ).toBe(false);
    });

    it("ignores malformed and non-http(s) URLs", () => {
        expect(shouldBlockRequest({ url: "not a url", resourceType: "script" })).toBe(false);
        expect(shouldBlockRequest({ url: "data:text/javascript,alert(1)", resourceType: "script" })).toBe(false);
        expect(shouldBlockRequest({ url: "", resourceType: "script" })).toBe(false);
    });

    it("uses a custom matcher when provided", () => {
        const matcher = createBlockedHostMatcher([...DEFAULT_BLOCKED_HOSTS, "tracker.test"]);
        expect(shouldBlockRequest({ url: "https://beacon.tracker.test/x", resourceType: "xhr" }, matcher)).toBe(
            true,
        );
        expect(shouldBlockRequest({ url: "https://doubleclick.net/x", resourceType: "image" }, matcher)).toBe(
            true,
        );
    });
});

describe("isBlockedUrl", () => {
    it("wraps shouldBlockRequest for simple URL checks", () => {
        expect(isBlockedUrl("https://google-analytics.com/collect")).toBe(true);
        expect(isBlockedUrl("https://example.com/app.js")).toBe(false);
    });
});
