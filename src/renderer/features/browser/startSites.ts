/** Categories used by the browser New Tab page. */
export type BrowserStartCategory = "manga" | "video";

/** One site tile on the New Tab page. */
export type BrowserStartSite = {
    id: string;
    name: string;
    url: string;
    domain: string;
    category: BrowserStartCategory;
    downloaderSupported?: boolean;
    blurb: string;
};

/**
 * Curated start page. The manga entries mirror the downloader extractors;
 * video entries are the three streaming sites requested by the user.
 */
export const BROWSER_START_SITES: readonly BrowserStartSite[] = [
    {
        id: "imhentai",
        name: "IMHentai",
        url: "https://imhentai.xxx/",
        domain: "imhentai.xxx",
        category: "manga",
        downloaderSupported: true,
        blurb: "Doujin & manga galleries",
    },
    {
        id: "nhentai",
        name: "nhentai",
        url: "https://nhentai.net/",
        domain: "nhentai.net",
        category: "manga",
        downloaderSupported: true,
        blurb: "Doujin library",
    },
    {
        id: "hitomi",
        name: "Hitomi",
        url: "https://hitomi.la/",
        domain: "hitomi.la",
        category: "manga",
        downloaderSupported: true,
        blurb: "Doujin galleries",
    },
    {
        id: "hentaivn",
        name: "HentaiVN",
        url: "https://hentaivnx.com/",
        domain: "hentaivnx.com",
        category: "manga",
        downloaderSupported: true,
        blurb: "Vietnamese manga reader",
    },
    {
        id: "vi-hentai",
        name: "Vi-Hentai",
        url: "https://vi-hentai.moe/",
        domain: "vi-hentai.moe",
        category: "manga",
        downloaderSupported: true,
        blurb: "Vietnamese doujin reader",
    },
    {
        id: "hanime",
        name: "Hanime",
        url: "https://hanime.tv/",
        domain: "hanime.tv",
        category: "video",
        blurb: "Hentai streaming",
    },
    {
        id: "watchhentai",
        name: "WatchHentai",
        url: "https://watchhentai.net/",
        domain: "watchhentai.net",
        category: "video",
        blurb: "Hentai streaming",
    },
    {
        id: "hentaihaven",
        name: "HentaiHaven",
        url: "https://hentaihaven.xxx/",
        domain: "hentaihaven.xxx",
        category: "video",
        blurb: "Hentai series & videos",
    },
];

/** Unique hosts used to prefetch/cached favicons for the start page. */
export const browserStartHosts = (): string[] => [...new Set(BROWSER_START_SITES.map((site) => site.domain))];
