import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { VIDEO_EXTS } from "@common/library/formats";
import type { BrowserScannedLink } from "@common/types/browser";
import type { DownloaderRecipeDraft } from "@common/types/downloader";
import { applyProxyToSession } from "@electron/network/proxySettings";
import {
    type BrowserWindow,
    type DownloadItem,
    dialog,
    session as electronSession,
    nativeTheme,
    type Session,
    WebContentsView,
} from "electron";
import { createMainLogger } from "../util/logger";
import { enableAdblockInSession } from "./adblock";
import { normalizeScannedLinks } from "./scanLinks";
import type {
    BrowserBounds,
    BrowserContextMenuRequest,
    BrowserCreateTabOptions,
    BrowserDownload,
    BrowserDownloadState,
    BrowserManagerOptions,
    BrowserNewTabRequest,
    BrowserState,
    BrowserTabSnapshot,
} from "./types";
import {
    type BrowserInputResolution,
    type BrowserSearchEngine,
    DEFAULT_SEARCH_ENGINE,
    getHostname,
    isAllowedBrowserUrl,
    normalizeHost,
    resolveBrowserInput,
    shouldForceDarkForUrl,
} from "./url";

const logger = createMainLogger("BrowserManager");

/** Persistent session shared by every browser tab. */
export const BROWSER_SESSION_PARTITION = "persist:browser";

const DARK_BACKGROUND = "#1b1b1f";
const LIGHT_BACKGROUND = "#ffffff";
const DEBUGGER_PROTOCOL_VERSION = "1.3";

/** Raw anchor rows collected per scan before dedupe/sort/cap in Node. */
const LINK_SCAN_RAW_LIMIT = 5000;

type PickedSelector = {
    selector: string;
    groupSelector: string;
    count: number;
    href: string;
    text: string;
};

/**
 * Injected page picker. Highlights the hovered element, then resolves a CSS
 * selector (plus a broader sibling selector for chapter/image lists).
 */
const pickSelectorInPage = (hint: string): Promise<PickedSelector | null> =>
    new Promise((resolve) => {
        const tip = document.createElement("div");
        tip.textContent = hint;
        Object.assign(tip.style, {
            position: "fixed",
            top: "14px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: "2147483647",
            padding: "8px 14px",
            borderRadius: "8px",
            background: "#111827",
            color: "#fff",
            font: "600 13px system-ui, sans-serif",
            boxShadow: "0 10px 30px rgba(0,0,0,.45)",
            pointerEvents: "none",
        });
        document.documentElement.appendChild(tip);

        let highlighted: HTMLElement | null = null;
        let previousOutline = "";
        const cssEscape = (value: string): string =>
            window.CSS?.escape ? window.CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");

        const specificPath = (element: Element): string => {
            const parts: string[] = [];
            let current: Element | null = element;
            while (current && current.nodeType === 1 && parts.length < 8) {
                if (current.id) {
                    parts.unshift(`#${cssEscape(current.id)}`);
                    break;
                }
                let part = current.tagName.toLowerCase();
                const classes = [...current.classList].filter((name) => /^[a-z][\w-]*$/i.test(name)).slice(0, 2);
                if (classes.length > 0) part += `.${classes.map(cssEscape).join(".")}`;
                const parent = current.parentElement;
                if (parent) {
                    const siblings = [...parent.children].filter((node) => node.tagName === current?.tagName);
                    if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
                }
                parts.unshift(part);
                const candidate = parts.join(" > ");
                if (document.querySelectorAll(candidate).length === 1) break;
                current = current.parentElement;
            }
            return parts.join(" > ");
        };

        const loosePath = (element: Element): string => {
            const parts: string[] = [];
            let current: Element | null = element;
            while (current && current.nodeType === 1 && parts.length < 4) {
                if (current.id) {
                    parts.unshift(`#${cssEscape(current.id)}`);
                    break;
                }
                let part = current.tagName.toLowerCase();
                const classes = [...current.classList].filter((name) => /^[a-z][\w-]*$/i.test(name)).slice(0, 2);
                if (classes.length > 0) part += `.${classes.map(cssEscape).join(".")}`;
                parts.unshift(part);
                current = current.parentElement;
            }
            return parts.join(" > ");
        };

        const groupFor = (element: Element): { selector: string; count: number } => {
            const tag = element.tagName.toLowerCase();
            const classes = [...element.classList].filter((name) => /^[a-z][\w-]*$/i.test(name));
            const classSuffix = classes.length > 0 ? `.${classes.slice(0, 2).map(cssEscape).join(".")}` : "";
            const candidates: string[] = [];
            let ancestor: Element | null = element.parentElement;
            for (let depth = 0; ancestor && depth < 4; depth += 1) {
                candidates.push(`${loosePath(ancestor)} ${tag}${classSuffix}`);
                ancestor = ancestor.parentElement;
            }
            candidates.push(`${tag}${classSuffix}`);
            for (const candidate of candidates) {
                try {
                    const count = document.querySelectorAll(candidate).length;
                    if (count > 1 && count <= 500) return { selector: candidate, count };
                } catch {
                    // invalid candidate
                }
            }
            const selector = specificPath(element);
            return { selector, count: document.querySelectorAll(selector).length };
        };

        const highlight = (element: HTMLElement | null) => {
            if (highlighted) highlighted.style.outline = previousOutline;
            highlighted = element;
            if (!element) return;
            previousOutline = element.style.outline;
            element.style.outline = "2px solid #38bdf8";
            element.style.outlineOffset = "-2px";
        };

        const cleanup = () => {
            highlight(null);
            tip.remove();
            document.removeEventListener("mouseover", onOver, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("keydown", onKey, true);
        };

        const onOver = (event: MouseEvent) => {
            const target = event.target as HTMLElement | null;
            if (!target || target === tip) return;
            highlight(target);
        };

        const onClick = (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const target = event.target as HTMLElement | null;
            if (!target || target === tip) return;
            const group = groupFor(target);
            const result: PickedSelector = {
                selector: specificPath(target),
                groupSelector: group.selector,
                count: group.count,
                href: target instanceof HTMLAnchorElement ? target.href : "",
                text: (target.textContent || "").replace(/\s+/g, " ").trim().slice(0, 100),
            };
            cleanup();
            resolve(result);
        };

        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            cleanup();
            resolve(null);
        };

        document.addEventListener("mouseover", onOver, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
    });

/**
 * Page script used by {@link BrowserManager.scanLinks}. Anchors expose an
 * already-absolute `href` (resolved against the document base URL); Node still
 * re-validates every URL before returning it to the renderer.
 */
const LINK_SCAN_SCRIPT = `
(() => {
    try {
        const rows = [];
        for (const anchor of document.querySelectorAll("a[href]")) {
            if (rows.length >= ${LINK_SCAN_RAW_LIMIT}) break;
            const href = anchor.href;
            if (!href) continue;
            rows.push({ href, text: anchor.textContent || "" });
        }
        return rows;
    } catch (error) {
        return [];
    }
})()
`;

/** Chromium clipboard permissions are the only ones granted to page content. */
const CLIPBOARD_PERMISSIONS = new Set([
    "clipboard-read",
    "clipboard-sanitized-write",
    "deprecated-sync-clipboard-read",
]);

type ThemeSource = "system" | "light" | "dark";

// biome-ignore lint/suspicious/noExplicitAny: Node's EventEmitter signatures are variadic.
type EventEmitterArgs = any[];
type EventEmitterListener = (...args: EventEmitterArgs) => void;

interface TabRecord {
    id: string;
    url: string;
    title: string;
    favicon: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    pendingUrl: string | null;
    view: WebContentsView | null;
}

interface ActiveDownload {
    item: DownloadItem;
    filename: string;
    savePath: string;
}

const isClipboardPermission = (permission: string): boolean => CLIPBOARD_PERMISSIONS.has(permission);

const isNavigableUrl = (url: string): boolean => url === "about:blank" || isAllowedBrowserUrl(url);

const toDownloadState = (state: string): BrowserDownloadState => {
    if (state === "completed" || state === "cancelled" || state === "interrupted") return state;
    return "progressing";
};

const sanitizeDownloadFilename = (filename: string): string => {
    const basename = path.basename(filename.replace(/\\/g, "/"));
    const withoutControls = [...basename].filter((character) => character.charCodeAt(0) >= 32).join("");
    const sanitized = withoutControls
        .replace(/[<>:"/\\|?*]/g, "_")
        .replace(/[. ]+$/g, "")
        .trim();
    if (!sanitized || sanitized === "." || sanitized === "..") return "download";
    return sanitized;
};

/**
 * Owns every browser tab for one BrowserWindow.
 *
 * Tabs are metadata-first: a `WebContentsView` is created only when a tab is
 * activated or navigated (lazy), and only the active view is attached to the
 * window while the manager is visible. There is no tab-count limit.
 */
export class BrowserManager extends EventEmitter {
    private static readonly instances = new Set<BrowserManager>();
    private static themeSourceBeforeForceDark: ThemeSource | null = null;

    private readonly window: BrowserWindow;
    private readonly session: Session;
    private readonly tabs = new Map<string, TabRecord>();
    private readonly tabOrder: string[] = [];
    private readonly disabledHosts = new Set<string>();
    private readonly activeDownloads = new Map<string, ActiveDownload>();
    private readonly onOpenDownloader?: (download: BrowserDownload) => void;
    private readonly handleWindowClosed = (): void => {
        this.destroy();
    };

    private readonly handleWillDownload = (_event: Electron.Event, item: DownloadItem): void => {
        if (this.destroyed) return;

        const filename = item.getFilename() || "download";
        const dir = this.directoryFor(filename);
        const existing = dir ? path.join(dir, sanitizeDownloadFilename(filename)) : "";

        if (existing && fs.existsSync(existing)) {
            try {
                item.pause();
            } catch (error) {
                logger.warn("could not pause duplicate download", error);
            }
            if (this.window.isDestroyed()) {
                item.cancel();
                return;
            }
            void dialog
                .showMessageBox(this.window, {
                    type: "question",
                    title: "Download again?",
                    message: `"${filename}" already exists in the download folder.`,
                    detail: "Choose Download again to save another copy with a number.",
                    buttons: ["Cancel", "Download again"],
                    defaultId: 0,
                    cancelId: 0,
                    noLink: true,
                })
                .then(({ response }) => {
                    if (this.destroyed || response !== 1) {
                        item.cancel();
                        return;
                    }
                    this.startDownload(item, filename, true);
                })
                .catch((error: unknown) => {
                    logger.warn("duplicate download confirmation failed", error);
                    try {
                        item.cancel();
                    } catch {
                        // already gone
                    }
                });
            return;
        }

        this.startDownload(item, filename, false);
    };

    private startDownload(item: DownloadItem, filename: string, resume: boolean): void {
        const id = `download-${Date.now()}-${this.nextDownloadId++}`;
        const savePath = this.prepareDownloadPath(filename, item);

        this.activeDownloads.set(id, { item, filename, savePath });
        const initial = this.downloadSnapshot(id, item, "progressing");
        this.emit("download", initial);
        this.emit("open-downloader", initial);
        try {
            this.onOpenDownloader?.(initial);
        } catch (error) {
            logger.warn("open-downloader callback failed", error);
        }

        item.on("updated", (_updatedEvent, state) => {
            if (this.destroyed) return;
            this.emit("download", this.downloadSnapshot(id, item, toDownloadState(state)));
        });

        item.once("done", (_doneEvent, state) => {
            if (!this.destroyed) {
                this.emit("download", this.downloadSnapshot(id, item, toDownloadState(state)));
            }
            this.activeDownloads.delete(id);
        });

        if (resume) {
            try {
                item.resume();
            } catch (error) {
                logger.warn("could not resume duplicate download", error);
            }
        }
    }

    private searchEngine: BrowserSearchEngine;
    private downloadDir: string | null = null;
    private videoDownloadDir: string | null = null;
    private activeId: string | null = null;
    private bounds: BrowserBounds = { x: 0, y: 0, width: 0, height: 0 };
    private visible = false;
    private forceDark: boolean;
    private nextTabId = 1;
    private nextDownloadId = 1;
    private destroyed = false;

    constructor(options: BrowserManagerOptions) {
        super();

        this.window = options.window;
        this.searchEngine = options.searchEngine ?? DEFAULT_SEARCH_ENGINE;
        this.forceDark = options.forceDark ?? true;
        this.onOpenDownloader = options.onOpenDownloader;
        this.session = electronSession.fromPartition(options.partition ?? BROWSER_SESSION_PARTITION, {
            cache: true,
        });

        this.configureSession();
        if (options.downloadDir) this.setDownloadDir(options.downloadDir);
        if (options.videoDownloadDir) this.videoDownloadDir = path.resolve(options.videoDownloadDir);

        this.window.once("closed", this.handleWindowClosed);
        BrowserManager.instances.add(this);
        this.syncGlobalTheme();
    }

    on(event: "state", listener: (state: BrowserState) => void): this;
    on(event: "download", listener: (download: BrowserDownload) => void): this;
    on(event: "new-tab-request", listener: (request: BrowserNewTabRequest) => void): this;
    on(event: "open-downloader", listener: (download: BrowserDownload) => void): this;
    on(event: "context-menu", listener: (request: BrowserContextMenuRequest) => void): this;
    on(event: string | symbol, listener: EventEmitterListener): this {
        return super.on(event, listener);
    }

    once(event: "state", listener: (state: BrowserState) => void): this;
    once(event: "download", listener: (download: BrowserDownload) => void): this;
    once(event: "new-tab-request", listener: (request: BrowserNewTabRequest) => void): this;
    once(event: "open-downloader", listener: (download: BrowserDownload) => void): this;
    once(event: "context-menu", listener: (request: BrowserContextMenuRequest) => void): this;
    once(event: string | symbol, listener: EventEmitterListener): this {
        return super.once(event, listener);
    }

    off(event: "state", listener: (state: BrowserState) => void): this;
    off(event: "download", listener: (download: BrowserDownload) => void): this;
    off(event: "new-tab-request", listener: (request: BrowserNewTabRequest) => void): this;
    off(event: "open-downloader", listener: (download: BrowserDownload) => void): this;
    off(event: "context-menu", listener: (request: BrowserContextMenuRequest) => void): this;
    off(event: string | symbol, listener: EventEmitterListener): this {
        return super.off(event, listener);
    }

    emit(event: "state", state: BrowserState): boolean;
    emit(event: "download", download: BrowserDownload): boolean;
    emit(event: "new-tab-request", request: BrowserNewTabRequest): boolean;
    emit(event: "open-downloader", download: BrowserDownload): boolean;
    emit(event: "context-menu", request: BrowserContextMenuRequest): boolean;
    emit(event: string | symbol, ...args: EventEmitterArgs): boolean {
        return super.emit(event, ...args);
    }

    /** Creates a tab from a URL or omnibox input and returns its id. */
    createTab(url = "about:blank", options: BrowserCreateTabOptions = {}): string {
        this.assertUsable();

        const target = this.resolveTarget(url) ?? "about:blank";
        const id = `tab-${this.nextTabId++}`;
        const tab: TabRecord = {
            id,
            url: target,
            title: "",
            favicon: "",
            loading: false,
            canGoBack: false,
            canGoForward: false,
            pendingUrl: null,
            view: null,
        };

        this.tabs.set(id, tab);
        this.tabOrder.push(id);

        if (options.activate === false) {
            this.emitState();
        } else {
            this.activateTab(id);
        }

        return id;
    }

    /** Closes a tab, activates a neighbour when it was active, and destroys its view. */
    closeTab(id: string): boolean {
        const tab = this.tabs.get(id);
        if (!tab) return false;

        const index = this.tabOrder.indexOf(id);
        this.destroyTabView(tab);
        this.tabs.delete(id);
        if (index !== -1) this.tabOrder.splice(index, 1);

        if (this.activeId === id) {
            this.activeId = null;
            const nextId = this.tabOrder[index] ?? this.tabOrder[index - 1] ?? null;
            if (nextId) {
                this.activateTab(nextId);
                return true;
            }
        }

        this.emitState();
        return true;
    }

    /** Makes a tab active, creating its view lazily if needed. */
    activateTab(id: string): boolean {
        const tab = this.tabs.get(id);
        if (!tab || this.destroyed) return false;

        const previous = this.activeId ? this.tabs.get(this.activeId) : null;
        if (previous && previous.id !== id) this.detachTabView(previous);

        this.activeId = id;
        const view = this.ensureView(tab);
        if (view) {
            this.syncActiveView();

            const currentUrl = view.webContents.getURL();
            if (tab.url !== "about:blank" && tab.url !== currentUrl && tab.url !== tab.pendingUrl) {
                this.loadTabUrl(tab, tab.url);
            }

            if (this.visible && !view.webContents.isDestroyed()) view.webContents.focus();
        }

        this.emitState();
        return true;
    }

    /** Navigates a tab to a URL or search input. */
    navigate(id: string, input: string, engine: BrowserSearchEngine = this.searchEngine): boolean {
        const tab = this.tabs.get(id);
        if (!tab || this.destroyed) return false;

        const target = this.resolveTarget(input, engine);
        if (!target) return false;

        tab.url = target;
        tab.title = "";
        tab.favicon = "";
        return this.loadTabUrl(tab, target);
    }

    /** Goes back in the given tab (defaults to the active tab). */
    back(id?: string): boolean {
        const view = this.tabView(id);
        if (!view || view.webContents.isDestroyed()) return false;
        if (!view.webContents.navigationHistory.canGoBack()) return false;
        view.webContents.navigationHistory.goBack();
        return true;
    }

    /** Goes forward in the given tab (defaults to the active tab). */
    forward(id?: string): boolean {
        const view = this.tabView(id);
        if (!view || view.webContents.isDestroyed()) return false;
        if (!view.webContents.navigationHistory.canGoForward()) return false;
        view.webContents.navigationHistory.goForward();
        return true;
    }

    /** Reloads the given tab (defaults to the active tab). */
    reload(id?: string): boolean {
        const tab = this.resolveTab(id);
        if (!tab) return false;
        const view = tab.view;
        if (!view || view.webContents.isDestroyed()) {
            return tab.url !== "about:blank" && this.loadTabUrl(tab, tab.url);
        }
        view.webContents.reload();
        return true;
    }

    /** Stops loading in the given tab (defaults to the active tab). */
    stop(id?: string): boolean {
        const tab = this.resolveTab(id);
        const view = tab?.view;
        if (!tab || !view || view.webContents.isDestroyed()) return false;
        if (!view.webContents.isLoading()) return false;

        view.webContents.stop();
        tab.loading = false;
        tab.pendingUrl = null;
        this.emitState();
        return true;
    }

    /**
     * Sets the active view bounds in device-independent pixels. The value is
     * retained while hidden and applied when shown again.
     */
    setBounds(bounds: BrowserBounds): void {
        this.bounds = {
            x: this.toPixel(bounds.x),
            y: this.toPixel(bounds.y),
            width: this.toPixel(bounds.width),
            height: this.toPixel(bounds.height),
        };
        this.syncActiveView();
    }

    getBounds(): BrowserBounds {
        return { ...this.bounds };
    }

    /** Attaches and shows the active view. */
    show(): void {
        this.setVisible(true);
    }

    /** Detaches the active view without destroying it. */
    hide(): void {
        this.setVisible(false);
    }

    setVisible(visible: boolean): void {
        if (this.destroyed) return;

        const changed = this.visible !== visible;
        this.visible = visible;
        if (visible) {
            const tab = this.activeTab();
            if (tab && (!tab.view || tab.view.webContents.isDestroyed())) {
                if (tab.url && tab.url !== "about:blank") {
                    this.loadTabUrl(tab, tab.url);
                } else {
                    this.ensureView(tab);
                }
            }
        }
        this.syncActiveView();

        if (visible) {
            const view = this.activeTab()?.view;
            if (view && !view.webContents.isDestroyed()) view.webContents.focus();
        } else if (!this.window.isDestroyed()) {
            // The native view is detached, so hand keyboard focus back to the app UI.
            this.window.webContents.focus();
        }

        if (changed) this.emitState();
    }

    /** Returns a serializable snapshot for renderer state. */
    getState(): BrowserState {
        const tabs = this.tabOrder
            .map((id) => this.tabs.get(id))
            .filter((tab): tab is TabRecord => Boolean(tab))
            .map((tab) => this.toSnapshot(tab));
        const active = this.activeId ? this.tabs.get(this.activeId) : undefined;

        return {
            tabs,
            activeId: this.activeId,
            loading: active?.loading ?? false,
            url: active?.url ?? "",
            title: active?.title ?? "",
            favicon: active?.favicon ?? "",
            canGoBack: active?.canGoBack ?? false,
            canGoForward: active?.canGoForward ?? false,
            forceDark: this.forceDark,
            visible: this.visible,
        };
    }

    /**
     * Captures the active page as a JPEG data URL. The renderer shows this
     * snapshot while a React overlay hides the native WebContentsView.
     */
    async capturePage(tabId?: string): Promise<string> {
        const tab = this.resolveTab(tabId);
        const view = tab?.view;
        if (!tab || !view || view.webContents.isDestroyed()) return "";
        try {
            const image = await view.webContents.capturePage();
            if (image.isEmpty()) return "";
            const jpeg = image.toJPEG(82);
            return jpeg.length > 0 ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : "";
        } catch (error) {
            logger.warn("could not capture browser page", error);
            return "";
        }
    }

    /** Runs the in-page visual selector picker and returns the chosen element. */
    private async pickSelector(hint: string, tabId?: string): Promise<PickedSelector | null> {
        const tab = this.resolveTab(tabId);
        const view = tab?.view;
        if (!tab || !view || view.webContents.isDestroyed()) return null;
        try {
            view.webContents.focus();
            return (await view.webContents.executeJavaScript(
                `(${pickSelectorInPage.toString()})(${JSON.stringify(hint)})`,
                true,
            )) as PickedSelector | null;
        } catch (error) {
            logger.warn("could not pick page selector", error);
            return null;
        }
    }

    /** Builds an editable recipe draft from the active page with visual pickers. */
    async buildRecipe(tabId?: string): Promise<DownloaderRecipeDraft | null> {
        const tab = this.resolveTab(tabId);
        const view = tab?.view;
        if (!tab || !view || view.webContents.isDestroyed()) return null;
        if (this.window.isDestroyed()) return null;

        const modeChoice = await dialog.showMessageBox(this.window, {
            type: "question",
            title: "Downloader recipe",
            message: `Build a recipe for this page?\n\n${tab.title || tab.url}`,
            detail: "Choose “Whole series” to pick a chapter link first; the app will open that chapter for the image selector.",
            buttons: ["This chapter or gallery", "Whole series", "Cancel"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
        });
        if (modeChoice.response === 2) return null;

        const series = modeChoice.response === 1;
        let chapter: PickedSelector | null = null;
        if (series) {
            chapter = await this.pickSelector("Click one chapter link", tab.id);
            if (!chapter) return null;
            if (!chapter.href) {
                await dialog.showMessageBox(this.window, {
                    type: "info",
                    title: "Recipe cancelled",
                    message: "That element is not a chapter link.",
                    buttons: ["OK"],
                });
                return null;
            }
            try {
                await view.webContents.loadURL(chapter.href);
                await new Promise((resolve) => setTimeout(resolve, 800));
            } catch (error) {
                logger.warn("could not open chapter for recipe", error);
                return null;
            }
        }

        const image = await this.pickSelector(
            series
                ? "Click one page image (or the element containing page images)"
                : "Click one page image or gallery element",
            tab.id,
        );
        if (!image) return null;

        const nextChoice = await dialog.showMessageBox(this.window, {
            type: "question",
            title: "Downloader recipe",
            message: "Does this reader use a next-page button?",
            buttons: ["No next page", "Add next-page button"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        });
        let next: PickedSelector | null = null;
        if (nextChoice.response === 1) {
            next = await this.pickSelector("Click the next-page button", tab.id);
            if (!next) return null;
        }

        let host = "";
        try {
            host = new URL(tab.url).hostname.replace(/^www\./i, "");
        } catch {
            host = "site";
        }
        const id = host.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "site";
        const name = (tab.title || host).replace(/\s+/g, " ").trim().slice(0, 90);
        return {
            id,
            name,
            match: [host],
            mode: series ? "series" : "gallery",
            titleSelector: "h1",
            chapterSelector: series ? chapter?.groupSelector : undefined,
            pageSelector: image.groupSelector,
            nextSelector: next?.selector,
            testUrl: tab.url,
        };
    }

    /**
     * Collects http(s) links from a tab (defaults to the active one). Returns
     * an empty list for `about:blank`, destroyed/lazy views, and page-script
     * failures so callers always receive a safe array.
     */
    async scanLinks(tabId?: string): Promise<BrowserScannedLink[]> {
        if (this.destroyed) return [];

        const tab = this.resolveTab(tabId);
        const view = tab?.view;
        if (!tab || !view || view.webContents.isDestroyed()) return [];

        const currentUrl = view.webContents.getURL();
        if (!isAllowedBrowserUrl(currentUrl)) return [];

        try {
            const raw: unknown = await view.webContents.executeJavaScript(LINK_SCAN_SCRIPT, false);
            return normalizeScannedLinks(raw, currentUrl);
        } catch (error) {
            logger.warn("could not scan links", currentUrl, error);
            return [];
        }
    }

    /** Enables or disables force-dark for every tab. */
    setForceDark(enabled: boolean): void {
        if (this.destroyed || this.forceDark === enabled) return;

        this.forceDark = enabled;
        this.syncGlobalTheme();
        for (const tab of this.tabs.values()) this.applyForceDark(tab);
        this.emitState();
    }

    /**
     * Enables or disables force-dark for a host (and its subdomains). `enabled`
     * true removes the host from the disabled set.
     */
    setHostForceDark(hostOrUrl: string, enabled: boolean): boolean {
        const host = getHostname(hostOrUrl) ?? normalizeHost(hostOrUrl);
        if (!host || /\s/.test(host)) return false;

        if (enabled) {
            this.disabledHosts.delete(host);
        } else {
            this.disabledHosts.add(host);
        }

        for (const tab of this.tabs.values()) this.applyForceDark(tab);
        this.emitState();
        return true;
    }

    isForceDarkEnabledFor(url: string): boolean {
        return shouldForceDarkForUrl(url, this.forceDark, this.disabledHosts);
    }

    getDisabledHosts(): string[] {
        return [...this.disabledHosts].sort();
    }

    getForceDark(): boolean {
        return this.forceDark;
    }

    setSearchEngine(engine: BrowserSearchEngine): void {
        this.searchEngine = engine;
    }

    getSearchEngine(): BrowserSearchEngine {
        return this.searchEngine;
    }

    /** Resolves omnibox input using the manager's active search engine. */
    resolveInput(input: string, engine: BrowserSearchEngine = this.searchEngine): BrowserInputResolution | null {
        return resolveBrowserInput(input, engine);
    }

    /** Sets (or clears) the directory used for automatic downloads. */
    setDownloadDir(dir: string | null): void {
        const resolved = dir ? path.resolve(dir) : null;
        if (resolved) {
            try {
                fs.mkdirSync(resolved, { recursive: true });
            } catch (error) {
                logger.warn("could not create download directory", resolved, error);
            }
        }
        this.downloadDir = resolved;
    }

    getDownloadDir(): string | null {
        return this.downloadDir;
    }

    /** `null` restores the OS Videos default. */
    setVideoDownloadDir(dir: string | null): void {
        const resolved = dir ? path.resolve(dir) : null;
        if (resolved) {
            try {
                fs.mkdirSync(resolved, { recursive: true });
            } catch (error) {
                logger.warn("could not create video download directory", resolved, error);
            }
        }
        this.videoDownloadDir = resolved;
    }

    /** Cancels an in-flight download by the id emitted on the `download` event. */
    cancelDownload(id: string): boolean {
        const download = this.activeDownloads.get(id);
        if (!download) return false;

        try {
            download.item.cancel();
            return true;
        } catch (error) {
            logger.warn("could not cancel download", id, error);
            return false;
        }
    }

    /**
     * Destroys every view, detaches session listeners, cancels active downloads,
     * and restores the previous native theme source when this was the last
     * force-dark browser manager.
     */
    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;

        try {
            this.window.removeListener("closed", this.handleWindowClosed);
        } catch (error) {
            logger.debug("could not remove window close listener", error);
        }

        this.session.removeListener("will-download", this.handleWillDownload);

        for (const tab of this.tabs.values()) this.destroyTabView(tab);
        this.tabs.clear();
        this.tabOrder.length = 0;
        this.activeId = null;

        for (const download of this.activeDownloads.values()) {
            try {
                download.item.cancel();
            } catch (error) {
                logger.debug("could not cancel download during destroy", error);
            }
        }
        this.activeDownloads.clear();

        BrowserManager.instances.delete(this);
        this.syncGlobalTheme();
        this.removeAllListeners();
    }

    private configureSession(): void {
        this.session.setPermissionRequestHandler((_webContents, permission, callback) => {
            callback(isClipboardPermission(permission));
        });
        this.session.setPermissionCheckHandler((_webContents, permission) => {
            return isClipboardPermission(permission);
        });
        this.session.on("will-download", this.handleWillDownload);
        enableAdblockInSession(this.session);
        void applyProxyToSession(this.session).catch((error: unknown) =>
            logger.warn("could not apply browser proxy", error),
        );
    }

    private assertUsable(): void {
        if (this.destroyed || this.window.isDestroyed()) {
            throw new Error("BrowserManager is no longer usable");
        }
    }

    private activeTab(): TabRecord | null {
        return this.activeId ? (this.tabs.get(this.activeId) ?? null) : null;
    }

    private resolveTab(id?: string): TabRecord | null {
        const tabId = id ?? this.activeId;
        return tabId ? (this.tabs.get(tabId) ?? null) : null;
    }

    private tabView(id?: string): WebContentsView | null {
        const view = this.resolveTab(id)?.view ?? null;
        return view && !view.webContents.isDestroyed() ? view : null;
    }

    private resolveTarget(input: string, engine: BrowserSearchEngine = this.searchEngine): string | null {
        const value = input.trim();
        if (!value) return null;
        if (value === "about:blank") return value;
        return resolveBrowserInput(value, engine)?.url ?? null;
    }

    private loadTabUrl(tab: TabRecord, url: string): boolean {
        const view = this.ensureView(tab);
        if (!view) {
            tab.loading = false;
            tab.pendingUrl = null;
            this.emitState();
            return false;
        }
        /* Reload/navigate can recreate a crashed view; attach it again. */
        if (this.activeId === tab.id) this.syncActiveView();

        tab.pendingUrl = url;
        tab.loading = true;

        try {
            void view.webContents.loadURL(url).catch((error: unknown) => {
                if (tab.pendingUrl === url) {
                    tab.pendingUrl = null;
                    tab.loading = false;
                }
                logger.debug("tab navigation failed", url, error);
                this.emitState();
            });
        } catch (error) {
            tab.pendingUrl = null;
            tab.loading = false;
            logger.warn("tab navigation threw", url, error);
            this.emitState();
            return false;
        }

        this.emitState();
        return true;
    }

    private ensureView(tab: TabRecord): WebContentsView | null {
        if (this.destroyed || this.window.isDestroyed()) return null;

        if (tab.view) {
            if (!tab.view.webContents.isDestroyed()) return tab.view;
            this.destroyTabView(tab);
        }

        try {
            const view = new WebContentsView({
                webPreferences: {
                    session: this.session,
                    nodeIntegration: false,
                    nodeIntegrationInWorker: false,
                    contextIsolation: true,
                    sandbox: true,
                    webSecurity: true,
                    allowRunningInsecureContent: false,
                    webviewTag: false,
                    safeDialogs: true,
                },
            });

            tab.view = view;
            view.setBackgroundColor(this.isForceDarkEnabledFor(tab.url) ? DARK_BACKGROUND : LIGHT_BACKGROUND);
            this.wireView(tab, view);
            this.applyForceDark(tab);
            return view;
        } catch (error) {
            logger.error("could not create tab view", error);
            return null;
        }
    }

    private wireView(tab: TabRecord, view: WebContentsView): void {
        const webContents = view.webContents;

        webContents.setWindowOpenHandler((details) => {
            if (isAllowedBrowserUrl(details.url)) {
                this.emit("new-tab-request", {
                    url: details.url,
                    openerTabId: tab.id,
                    disposition: details.disposition,
                });
            }
            return { action: "deny" };
        });

        webContents.on("will-navigate", (details) => {
            if (!isNavigableUrl(details.url)) details.preventDefault();
        });
        webContents.on("will-redirect", (details) => {
            if (!isNavigableUrl(details.url)) details.preventDefault();
        });

        webContents.on("context-menu", (_event, params) => {
            this.emit("context-menu", {
                tabId: tab.id,
                linkURL: params.linkURL,
                pageURL: params.pageURL,
                selectionText: params.selectionText,
                x: params.x,
                y: params.y,
            });
        });

        webContents.on("did-start-loading", () => {
            tab.loading = true;
            this.emitState();
        });

        webContents.on("did-stop-loading", () => {
            tab.loading = false;
            tab.pendingUrl = null;
            this.refreshTab(tab);
            this.emitState();
        });

        webContents.on("did-navigate", (_event, url) => {
            if (isNavigableUrl(url)) tab.url = url;
            tab.pendingUrl = null;
            this.refreshTab(tab);
            this.applyForceDark(tab);
            this.emitState();
        });

        webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
            if (!isMainFrame) return;
            if (isNavigableUrl(url)) tab.url = url;
            this.refreshTab(tab);
            this.emitState();
        });

        webContents.on("page-title-updated", (_event, title) => {
            tab.title = title;
            this.emitState();
        });

        webContents.on("page-favicon-updated", (_event, favicons) => {
            tab.favicon = favicons[0] ?? "";
            this.emitState();
        });

        webContents.on("did-fail-load", (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
            if (!isMainFrame) return;
            tab.loading = false;
            tab.pendingUrl = null;
            if (errorCode !== -3 && isNavigableUrl(validatedURL)) tab.url = validatedURL;
            this.refreshTab(tab);
            this.emitState();
        });

        webContents.on("dom-ready", () => {
            this.applyForceDark(tab);
        });

        webContents.on("render-process-gone", (_event, details) => {
            if (details.reason === "clean-exit" || this.destroyed || this.window.isDestroyed()) return;
            logger.warn("browser renderer gone", {
                tabId: tab.id,
                url: tab.url,
                reason: details.reason,
                exitCode: details.exitCode,
            });
            if (tab.view !== view) return;
            tab.view = null;
            tab.loading = false;
            tab.pendingUrl = null;
            try {
                this.window.contentView.removeChildView(view);
            } catch (error) {
                logger.debug("could not detach crashed view", error);
            }
            this.emitState();
            /* The crashed webContents is already tearing down; recreate after it settles. */
            setTimeout(() => {
                if (this.destroyed || this.window.isDestroyed()) return;
                if (this.activeId !== tab.id || !this.visible) return;
                if (tab.url && tab.url !== "about:blank") {
                    this.loadTabUrl(tab, tab.url);
                } else {
                    this.ensureView(tab);
                    this.syncActiveView();
                }
            }, 0);
        });

        webContents.once("destroyed", () => {
            if (tab.view === view) tab.view = null;
            tab.loading = false;
            tab.pendingUrl = null;
            if (!this.window.isDestroyed()) {
                try {
                    this.window.contentView.removeChildView(view);
                } catch (error) {
                    logger.debug("could not remove destroyed view", error);
                }
            }
            this.emitState();
        });
    }

    private refreshTab(tab: TabRecord): void {
        const webContents = tab.view?.webContents;
        if (!webContents || webContents.isDestroyed()) return;

        tab.canGoBack = webContents.navigationHistory.canGoBack();
        tab.canGoForward = webContents.navigationHistory.canGoForward();
        const currentUrl = webContents.getURL();
        if (isNavigableUrl(currentUrl)) tab.url = currentUrl;
    }

    private applyForceDark(tab: TabRecord): void {
        const view = tab.view;
        if (!view || view.webContents.isDestroyed()) return;

        const enabled = this.isForceDarkEnabledFor(tab.url);
        try {
            view.setBackgroundColor(enabled ? DARK_BACKGROUND : LIGHT_BACKGROUND);
        } catch (error) {
            logger.debug("could not set view background", error);
        }

        const debuggerApi = view.webContents.debugger;
        try {
            if (!debuggerApi.isAttached()) debuggerApi.attach(DEBUGGER_PROTOCOL_VERSION);
        } catch (error) {
            logger.debug("could not attach debugger for force-dark", error);
            return;
        }

        void debuggerApi
            .sendCommand("Emulation.setEmulatedMedia", {
                features: [{ name: "prefers-color-scheme", value: enabled ? "dark" : "light" }],
            })
            .catch((error: unknown) => logger.debug("setEmulatedMedia failed", error));

        void debuggerApi
            .sendCommand("Emulation.setAutoDarkModeOverride", { enabled })
            .catch((error: unknown) => logger.debug("setAutoDarkModeOverride failed", error));
    }

    private syncActiveView(): void {
        if (this.destroyed) return;

        const tab = this.activeTab();
        const view = tab?.view;
        if (!view || view.webContents.isDestroyed()) return;

        if (!this.window.isDestroyed()) {
            try {
                if (this.visible) {
                    if (!this.window.contentView.children.includes(view)) {
                        this.window.contentView.addChildView(view);
                    }
                    view.setBounds(this.bounds);
                    view.setVisible(true);
                } else {
                    view.setVisible(false);
                    this.window.contentView.removeChildView(view);
                }
            } catch (error) {
                logger.debug("could not sync active view", error);
            }
        }
    }

    private detachTabView(tab: TabRecord): void {
        const view = tab.view;
        if (!view || this.window.isDestroyed()) return;
        try {
            this.window.contentView.removeChildView(view);
        } catch (error) {
            logger.debug("could not detach tab view", error);
        }
    }

    private destroyTabView(tab: TabRecord): void {
        const view = tab.view;
        tab.view = null;
        if (!view) return;

        if (!this.window.isDestroyed()) {
            try {
                this.window.contentView.removeChildView(view);
            } catch (error) {
                logger.debug("could not detach view during destroy", error);
            }
        }

        try {
            if (!view.webContents.isDestroyed()) {
                view.webContents.close({ waitForBeforeUnload: false });
            }
        } catch (error) {
            logger.debug("could not close tab webContents", error);
        }
    }

    /** Videos go to the media folder so they never mix into the manga library root. */
    private directoryFor(filename: string): string | null {
        const extension = path.extname(filename).toLowerCase();
        if (VIDEO_EXTS.includes(extension as (typeof VIDEO_EXTS)[number]) && this.videoDownloadDir) {
            return this.videoDownloadDir;
        }
        return this.downloadDir;
    }

    private prepareDownloadPath(filename: string, item: DownloadItem): string {
        const dir = this.directoryFor(filename);
        if (!dir) return "";

        try {
            fs.mkdirSync(dir, { recursive: true });
            const savePath = this.uniqueDownloadPath(dir, filename);
            item.setSavePath(savePath);
            return savePath;
        } catch (error) {
            logger.warn("could not prepare download path", filename, error);
            return "";
        }
    }

    private uniqueDownloadPath(dir: string, filename: string): string {
        const safeName = sanitizeDownloadFilename(filename);
        let candidate = path.join(dir, safeName);
        if (!fs.existsSync(candidate)) return candidate;

        const extension = path.extname(safeName);
        const basename = safeName.slice(0, safeName.length - extension.length) || "download";
        for (let index = 1; index < 10_000; index++) {
            candidate = path.join(dir, `${basename} (${index})${extension}`);
            if (!fs.existsSync(candidate)) return candidate;
        }
        return path.join(dir, `${basename}-${Date.now()}${extension}`);
    }

    private downloadSnapshot(id: string, item: DownloadItem, state: BrowserDownloadState): BrowserDownload {
        const active = this.activeDownloads.get(id);
        return {
            id,
            filename: active?.filename || item.getFilename(),
            state,
            received: item.getReceivedBytes(),
            total: item.getTotalBytes(),
            savePath: active?.savePath || item.getSavePath() || "",
            url: item.getURL(),
        };
    }

    private syncGlobalTheme(): void {
        const anyForced = [...BrowserManager.instances].some((manager) => manager.forceDark);

        if (anyForced) {
            if (BrowserManager.themeSourceBeforeForceDark === null) {
                BrowserManager.themeSourceBeforeForceDark = nativeTheme.themeSource;
            }
            nativeTheme.themeSource = "dark";
            return;
        }

        if (BrowserManager.themeSourceBeforeForceDark !== null) {
            nativeTheme.themeSource = BrowserManager.themeSourceBeforeForceDark;
            BrowserManager.themeSourceBeforeForceDark = null;
        }
    }

    private toSnapshot(tab: TabRecord): BrowserTabSnapshot {
        return {
            id: tab.id,
            url: tab.url,
            title: tab.title,
            favicon: tab.favicon,
            loading: tab.loading,
            canGoBack: tab.canGoBack,
            canGoForward: tab.canGoForward,
            active: tab.id === this.activeId,
        };
    }

    private emitState(): void {
        if (this.destroyed) return;
        this.emit("state", this.getState());
    }

    private toPixel(value: number): number {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.round(value));
    }
}
