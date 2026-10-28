/** Categories used by the browser New Tab page. */
export type BrowserStartCategory = "reading" | "media" | "tools";

/** One site tile on the New Tab page. */
export type BrowserStartSite = {
    id: string;
    name: string;
    url: string;
    domain: string;
    category: BrowserStartCategory;
};

/**
 * Neutral public defaults. The repo ships no site-specific downloader presets;
 * users can still open any URL from the address bar.
 */
export const BROWSER_START_SITES: readonly BrowserStartSite[] = [
    {
        id: "wikipedia",
        name: "Wikipedia",
        url: "https://www.wikipedia.org/",
        domain: "wikipedia.org",
        category: "reading",
    },
    {
        id: "gutenberg",
        name: "Project Gutenberg",
        url: "https://www.gutenberg.org/",
        domain: "gutenberg.org",
        category: "reading",
    },
    {
        id: "internet-archive",
        name: "Internet Archive",
        url: "https://archive.org/",
        domain: "archive.org",
        category: "reading",
    },
    {
        id: "open-library",
        name: "Open Library",
        url: "https://openlibrary.org/",
        domain: "openlibrary.org",
        category: "reading",
    },
    {
        id: "github",
        name: "GitHub",
        url: "https://github.com/",
        domain: "github.com",
        category: "tools",
    },
    {
        id: "mdn",
        name: "MDN",
        url: "https://developer.mozilla.org/",
        domain: "developer.mozilla.org",
        category: "tools",
    },
    {
        id: "youtube",
        name: "YouTube",
        url: "https://www.youtube.com/",
        domain: "youtube.com",
        category: "media",
    },
    {
        id: "vimeo",
        name: "Vimeo",
        url: "https://vimeo.com/",
        domain: "vimeo.com",
        category: "media",
    },
];

/** Unique hosts used to prefetch/cached favicons for the start page. */
export const browserStartHosts = (): string[] => [...new Set(BROWSER_START_SITES.map((site) => site.domain))];
