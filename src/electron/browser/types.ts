import type { BrowserWindow } from "electron";
import type { BrowserSearchEngine } from "./url";

/** Device-independent-pixel rectangle used to lay the active view over the window. */
export interface BrowserBounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface BrowserTab {
    id: string;
    url: string;
    title: string;
    favicon: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
}

export interface BrowserTabSnapshot extends BrowserTab {
    active: boolean;
}

/** Aggregate state emitted by the `state` event and returned by `getState()`. */
export interface BrowserState {
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
}

export type BrowserDownloadState = "progressing" | "completed" | "cancelled" | "interrupted";

export interface BrowserDownload {
    id: string;
    filename: string;
    state: BrowserDownloadState;
    received: number;
    total: number;
    savePath: string;
    url: string;
}

export type BrowserNewTabDisposition = "default" | "foreground-tab" | "background-tab" | "new-window" | "other";

export interface BrowserNewTabRequest {
    url: string;
    /** Tab that requested the popup; useful for opening the new tab next to it. */
    openerTabId: string;
    disposition: BrowserNewTabDisposition;
}

export interface BrowserContextMenuRequest {
    tabId: string;
    linkURL: string;
    pageURL: string;
    selectionText: string;
    x: number;
    y: number;
}

export interface BrowserCreateTabOptions {
    /** Defaults to true, matching browser tab-strip behavior. */
    activate?: boolean;
}

export interface BrowserManagerOptions {
    window: BrowserWindow;
    /** Directory for automatic downloads. Omit to let Electron prompt. */
    downloadDir?: string;
    /** Directory for video downloads (mp4/webm); defaults to {@link downloadDir}. */
    videoDownloadDir?: string;
    /** Defaults to Brave. */
    searchEngine?: BrowserSearchEngine;
    /** Global force-dark switch. Defaults to true. */
    forceDark?: boolean;
    /** Session partition. Defaults to `persist:browser`. */
    partition?: string;
    /** Optional callback in addition to the `open-downloader` event. */
    onOpenDownloader?: (download: BrowserDownload) => void;
}
