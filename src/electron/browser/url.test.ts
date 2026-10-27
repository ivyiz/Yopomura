import { describe, expect, it } from "vitest";
import {
    buildSearchUrl,
    getHostname,
    hostMatchesDomain,
    isAllowedBrowserUrl,
    isHostDisabled,
    isSearchEngine,
    normalizeHost,
    normalizeUrl,
    resolveBrowserInput,
    shouldForceDarkForUrl,
} from "./url";

describe("normalizeUrl", () => {
    it("assumes https for bare hosts and keeps paths, queries, and hashes", () => {
        expect(normalizeUrl("example.com")).toBe("https://example.com/");
        expect(normalizeUrl("www.example.com/path?q=1#section")).toBe("https://www.example.com/path?q=1#section");
        expect(normalizeUrl("//example.com/x")).toBe("https://example.com/x");
    });

    it("preserves explicit http(s) schemes and normalizes host casing", () => {
        expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
        expect(normalizeUrl("HTTPS://EXAMPLE.COM/Path")).toBe("https://example.com/Path");
        expect(normalizeUrl("http:example.com")).toBe("http://example.com/");
    });

    it("supports localhost, IPv4, and IPv6 literals", () => {
        expect(normalizeUrl("localhost:3000")).toBe("https://localhost:3000/");
        expect(normalizeUrl("example.com:8080")).toBe("https://example.com:8080/");
        expect(normalizeUrl("127.0.0.1:8080/a")).toBe("https://127.0.0.1:8080/a");
        expect(normalizeUrl("http://[::1]:8080/x")).toBe("http://[::1]:8080/x");
    });

    it("rejects search phrases, unsupported schemes, and malformed hosts", () => {
        expect(normalizeUrl("")).toBeNull();
        expect(normalizeUrl("   ")).toBeNull();
        expect(normalizeUrl("hello")).toBeNull();
        expect(normalizeUrl("not a url")).toBeNull();
        expect(normalizeUrl("1.2.3")).toBeNull();
        expect(normalizeUrl("javascript:alert(1)")).toBeNull();
        expect(normalizeUrl("file:///C:/Windows")).toBeNull();
        expect(normalizeUrl("mailto:reader@example.com")).toBeNull();
        expect(normalizeUrl("ftp://example.com/file")).toBeNull();
        expect(normalizeUrl("999.1.1.1")).toBeNull();
    });
});

describe("isAllowedBrowserUrl", () => {
    it("accepts only absolute http(s) URLs", () => {
        expect(isAllowedBrowserUrl("https://example.com")).toBe(true);
        expect(isAllowedBrowserUrl("http://localhost:3000/reader")).toBe(true);
        expect(isAllowedBrowserUrl("about:blank")).toBe(false);
        expect(isAllowedBrowserUrl("javascript:alert(1)")).toBe(false);
        expect(isAllowedBrowserUrl("file:///C:/Windows")).toBe(false);
        expect(isAllowedBrowserUrl("https://")).toBe(false);
        expect(isAllowedBrowserUrl("not a url")).toBe(false);
    });
});

describe("search URL helpers", () => {
    it("builds the default Brave search URL with safesearch off", () => {
        expect(buildSearchUrl("hello world")).toBe(
            "https://search.brave.com/search?q=hello%20world&safesearch=off",
        );
    });

    it("builds Google and DuckDuckGo URLs and encodes unsafe characters", () => {
        expect(buildSearchUrl("hello world", "google")).toBe(
            "https://www.google.com/search?q=hello%20world&safe=off",
        );
        expect(buildSearchUrl("  a&b?  ", "duckduckgo")).toBe("https://duckduckgo.com/?q=a%26b%3F&kp=-2");
    });

    it("recognizes engine ids", () => {
        expect(isSearchEngine("brave")).toBe(true);
        expect(isSearchEngine("google")).toBe(true);
        expect(isSearchEngine("duckduckgo")).toBe(true);
        expect(isSearchEngine("bing")).toBe(false);
    });
});

describe("resolveBrowserInput", () => {
    it("returns normalized URLs for URL-like input", () => {
        expect(resolveBrowserInput("example.com", "google")).toEqual({
            kind: "url",
            url: "https://example.com/",
        });
        expect(resolveBrowserInput("http://example.com/read")).toEqual({
            kind: "url",
            url: "http://example.com/read",
        });
    });

    it("falls back to the selected search engine", () => {
        expect(resolveBrowserInput("hello world", "duckduckgo")).toEqual({
            kind: "search",
            url: "https://duckduckgo.com/?q=hello%20world&kp=-2",
            query: "hello world",
            engine: "duckduckgo",
        });
        expect(resolveBrowserInput("manga", "google")).toEqual({
            kind: "search",
            url: "https://www.google.com/search?q=manga&safe=off",
            query: "manga",
            engine: "google",
        });
    });

    it("returns null for empty input and searches unsupported schemes instead of loading them", () => {
        expect(resolveBrowserInput("   ")).toBeNull();
        expect(resolveBrowserInput("javascript:alert(1)")).toEqual({
            kind: "search",
            url: "https://search.brave.com/search?q=javascript%3Aalert(1)&safesearch=off",
            query: "javascript:alert(1)",
            engine: "brave",
        });
    });
});

describe("force-dark host logic", () => {
    it("normalizes hosts and extracts them from URLs or bare input", () => {
        expect(normalizeHost(" Example.COM. ")).toBe("example.com");
        expect(getHostname("https://www.example.com/path")).toBe("www.example.com");
        expect(getHostname("example.com:8080/path")).toBe("example.com");
        expect(getHostname("http:example.com")).toBe("example.com");
        expect(getHostname("javascript:alert(1)")).toBeNull();
        expect(getHostname("not a host")).toBeNull();
    });

    it("matches a domain and its subdomains but not lookalikes", () => {
        expect(hostMatchesDomain("example.com", "example.com")).toBe(true);
        expect(hostMatchesDomain("sub.example.com", "example.com")).toBe(true);
        expect(hostMatchesDomain("deep.sub.example.com", "example.com")).toBe(true);
        expect(hostMatchesDomain("badexample.com", "example.com")).toBe(false);
        expect(hostMatchesDomain("example.com.evil.test", "example.com")).toBe(false);
        expect(hostMatchesDomain("example.com", "sub.example.com")).toBe(false);
    });

    it("requires IP literals to match exactly", () => {
        expect(hostMatchesDomain("192.168.1.1", "192.168.1.1")).toBe(true);
        expect(hostMatchesDomain("192.168.1.1", "168.1.1")).toBe(false);
    });

    it("disables force-dark for a host and its subdomains", () => {
        const disabled = ["Example.COM."];

        expect(isHostDisabled("https://example.com/page", disabled)).toBe(true);
        expect(isHostDisabled("https://deep.sub.example.com", disabled)).toBe(true);
        expect(isHostDisabled("https://example.com.evil.test", disabled)).toBe(false);
        expect(isHostDisabled("https://other.test", disabled)).toBe(false);

        expect(shouldForceDarkForUrl("https://example.com", true, disabled)).toBe(false);
        expect(shouldForceDarkForUrl("https://deep.sub.example.com", true, disabled)).toBe(false);
        expect(shouldForceDarkForUrl("https://other.test", true, disabled)).toBe(true);
    });

    it("follows the global switch and host-less documents", () => {
        expect(shouldForceDarkForUrl("https://example.com", false, [])).toBe(false);
        expect(shouldForceDarkForUrl("about:blank", true, [])).toBe(true);
        expect(shouldForceDarkForUrl("about:blank", false, [])).toBe(false);
    });
});
