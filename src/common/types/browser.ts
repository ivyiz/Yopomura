export type BrowserSearchEngine = "brave" | "google" | "duckduckgo";

export type BrowserBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
};

export type BrowserTab = {
    id: string;
    url: string;
    title: string;
    favicon: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
};

export type BrowserTabSnapshot = BrowserTab & { active: boolean };

export type BrowserState = {
    tabs: BrowserTabSnapshot[];
    activeId: string | null;
    loading: boolean;
    url: string;
    title: string;
    favicon: string;
    canGoBack: boolean;
    canGoForward: boolean;
    forceDark: boolean;
    visible: boolean;
};

export type BrowserDownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export type BrowserDownload = {
    id: string;
    filename: string;
    state: BrowserDownloadState;
    received: number;
    total: number;
    savePath: string;
    url: string;
};

export type BrowserNewTabDisposition = "default" | "foreground-tab" | "background-tab" | "new-window" | "other";

export type BrowserNewTabRequest = {
    url: string;
    openerTabId: string;
    disposition: BrowserNewTabDisposition;
};

export type BrowserContextMenuRequest = {
    tabId: string;
    linkURL: string;
    pageURL: string;
    selectionText: string;
    x: number;
    y: number;
};

/** One link returned by the browser link scanner. */
export type BrowserScannedLink = {
    url: string;
    text: string;
};

/** One saved browser bookmark. */
export type BrowserBookmark = {
    id: string;
    url: string;
    title: string;
    favicon: string;
    /** Unix milliseconds. */
    createdAt: number;
};

/** Ad-blocking state for the integrated browser session. */
export type BrowserAdblockState = {
    enabled: boolean;
    ready: boolean;
};
