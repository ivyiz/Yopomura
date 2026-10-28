import type {
    BrowserBookmark,
    BrowserContextMenuRequest,
    BrowserDownload,
    BrowserScannedLink,
    BrowserSearchEngine,
    BrowserState,
} from "@common/types/browser";
import { faBookmark as faBookmarkRegular } from "@fortawesome/free-regular-svg-icons";
import {
    faArrowLeft,
    faArrowRight,
    faBookmark as faBookmarkSolid,
    faDownload,
    faGlobe,
    faLink,
    faMoon,
    faPlus,
    faPuzzlePiece,
    faRotate,
    faShield,
    faShieldHalved,
    faSun,
    faUpRightFromSquare,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppContext } from "@renderer/App";
import { useAppSelector } from "@store/hooks";
import { selectModalOverlayOpen } from "@store/ui";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BrowserBookmarkBubble from "./BrowserBookmarkBubble";
import BrowserExtensionsMenu, { type BrowserToolEntry } from "./BrowserExtensionsMenu";
import BrowserStartPage from "./BrowserStartPage";
import type { BrowserMode, ToggleBrowserDetail } from "./browserEvents";
import {
    BROWSER_TOOLS,
    type BrowserToolId,
    DEFAULT_PINNED_TOOL_IDS,
    normalizePinnedToolIds,
    readPinnedToolIds,
    savePinnedToolIds,
} from "./browserTools";
import "./browserHost.scss";

type ContextMenuState = BrowserContextMenuRequest & {
    /** Window coordinates for the React menu. */
    menuX: number;
    menuY: number;
};

const EMPTY_STATE: BrowserState = {
    tabs: [],
    activeId: null,
    loading: false,
    url: "",
    title: "",
    favicon: "",
    canGoBack: false,
    canGoForward: false,
    forceDark: true,
    visible: false,
};

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname;
    } catch {
        return "";
    }
};

/** Compares pages using URL normalization so trailing slashes do not matter. */
const samePageUrl = (left: string, right: string): boolean => {
    try {
        return new URL(left).href === new URL(right).href;
    } catch {
        return left === right;
    }
};

const isBookmarkableUrl = (url: string | undefined): boolean => Boolean(url && /^https?:\/\//i.test(url));

const readSavedEngine = (): BrowserSearchEngine => {
    const saved = window.localStorage.getItem("yokomura-browser-engine");
    return saved === "google" || saved === "duckduckgo" ? saved : "brave";
};

const readSavedDisabledHosts = (): string[] => {
    try {
        const saved = JSON.parse(
            window.localStorage.getItem("yokomura-browser-disabled-hosts") ?? "[]",
        ) as unknown;
        return Array.isArray(saved)
            ? saved.filter((host): host is string => typeof host === "string" && Boolean(host))
            : [];
    } catch {
        return [];
    }
};

/** Ad blocking defaults to on; localStorage stores "off" when disabled. */
const readSavedAdblock = (): boolean => {
    return window.localStorage.getItem("yokomura-browser-adblock") !== "off";
};

/**
 * React shell for the native WebContentsView browser. The native view sits over
 * `.browserContent`; tabs/toolbar/menus stay in the renderer.
 */
const BrowserHost = () => {
    const { openDownloader, downloaderOpen, videoOpen, trashOpen, mediaOpen } = useAppContext();
    const folders = useAppSelector((store) => store.mainSettings.library.folders);
    const defaultOutDir = useAppSelector((store) => {
        const folder = store.mainSettings.library.folders.find((row) => row.isDefaultLocation);
        return folder?.path ?? "";
    });
    const modalOverlayOpen = useAppSelector(selectModalOverlayOpen);
    const readerActive = useAppSelector((store) => store.reader.active);

    const [mode, setMode] = useState<BrowserMode | null>(null);
    const [state, setState] = useState<BrowserState>(EMPTY_STATE);
    const newTabPage = !state.activeId || !state.url || state.url === "about:blank";
    const [address, setAddress] = useState("");
    const [engine, setEngine] = useState<BrowserSearchEngine>(readSavedEngine);
    const [sideWidth, setSideWidth] = useState(460);
    const [disabledHosts, setDisabledHosts] = useState<string[]>(readSavedDisabledHosts);
    const [menu, setMenu] = useState<ContextMenuState | null>(null);
    const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
    const [error, setError] = useState("");
    const [scanOpen, setScanOpen] = useState(false);
    const [scanLoading, setScanLoading] = useState(false);
    const [scanLinks, setScanLinks] = useState<BrowserScannedLink[]>([]);
    const [scanSelected, setScanSelected] = useState<string[]>([]);
    const [scanFilter, setScanFilter] = useState("");
    const [scanError, setScanError] = useState("");
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([]);
    const [bookmarkBubble, setBookmarkBubble] = useState<{
        bookmark: BrowserBookmark;
        created: boolean;
    } | null>(null);
    const [pinnedTools, setPinnedTools] = useState<BrowserToolId[]>(readPinnedToolIds);
    const [adblockEnabled, setAdblockEnabled] = useState<boolean>(readSavedAdblock);
    const modeRef = useRef<BrowserMode | null>(null);
    const paneRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastBounds = useRef("");
    const addressFocused = useRef(false);

    const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
    const activeBookmark = useMemo(
        () =>
            activeTab?.url ? bookmarks.find((bookmark) => samePageUrl(bookmark.url, activeTab.url)) : undefined,
        [bookmarks, activeTab?.url],
    );
    const bookmarkable = isBookmarkableUrl(activeTab?.url);

    const openBookmarkBubble = useCallback(async () => {
        const tab = activeTab;
        if (!tab || !isBookmarkableUrl(tab.url)) return;
        setMenu(null);
        setExtensionsOpen(false);
        setScanOpen(false);
        if (activeBookmark) {
            setBookmarkBubble({ bookmark: activeBookmark, created: false });
            return;
        }

        try {
            const created = await window.electron.invoke("browser:addBookmark", {
                url: tab.url,
                title: tab.title || hostOf(tab.url),
                favicon: tab.favicon,
            });
            if (!created) return;
            setBookmarks((previous) =>
                previous.some((bookmark) => bookmark.id === created.id) ? previous : [created, ...previous],
            );
            setBookmarkBubble({ bookmark: created, created: true });
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not save this bookmark");
        }
    }, [activeBookmark, activeTab]);

    const filteredScanLinks = useMemo(() => {
        const query = scanFilter.trim().toLowerCase();
        if (!query) return scanLinks;
        return scanLinks.filter(
            (link) => link.text.toLowerCase().includes(query) || link.url.toLowerCase().includes(query),
        );
    }, [scanLinks, scanFilter]);

    const contentBounds = useCallback(() => {
        const rect = contentRef.current?.getBoundingClientRect();
        if (!rect) return null;
        return {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.max(0, Math.round(rect.width)),
            height: Math.max(0, Math.round(rect.height)),
        };
    }, []);

    const syncBounds = useCallback(() => {
        const bounds = contentBounds();
        if (!bounds || !mode) return;
        const key = `${bounds.x}:${bounds.y}:${bounds.width}:${bounds.height}`;
        if (key === lastBounds.current) return;
        lastBounds.current = key;
        void window.electron.invoke("browser:setBounds", bounds);
    }, [contentBounds, mode]);

    const refreshHosts = useCallback(async () => {
        setDisabledHosts(await window.electron.invoke("browser:getDisabledHosts"));
    }, []);

    const ensureTab = useCallback(async () => {
        const next = await window.electron.invoke("browser:getState");
        setState(next);
        if (next.tabs.length === 0) {
            await window.electron.invoke("browser:createTab", { url: "about:blank" });
        }
        await refreshHosts();
    }, [refreshHosts]);

    useEffect(() => {
        modeRef.current = mode;
    }, [mode]);

    useEffect(() => {
        const onToggle = (event: Event) => {
            const detail = (event as CustomEvent<ToggleBrowserDetail>).detail;
            if (!detail?.mode) return;
            const current = modeRef.current;
            const next = current === null ? detail.mode : current === detail.mode ? null : detail.mode;
            modeRef.current = next;
            setMode(next);
            setMenu(null);
            setExtensionsOpen(false);
            setBookmarkBubble(null);
            if (!next) return;

            const saved = readSavedEngine();
            setEngine(saved);
            void window.electron.invoke("browser:setSearchEngine", { engine: saved });
            const savedAdblock = readSavedAdblock();
            setAdblockEnabled(savedAdblock);
            void window.electron.invoke("browser:setAdblock", { enabled: savedAdblock });
            for (const host of readSavedDisabledHosts()) {
                void window.electron.invoke("browser:setHostForceDark", {
                    hostOrUrl: host,
                    enabled: false,
                });
            }
            void ensureTab();
        };
        window.addEventListener("yokomura:toggle-browser", onToggle);
        return () => window.removeEventListener("yokomura:toggle-browser", onToggle);
    }, [ensureTab]);

    useEffect(() => {
        const offState = window.electron.on("browser:state", (next) => {
            setState(next);
            setError("");
        });
        const offMenu = window.electron.on("browser:contextMenu", (request) => {
            const bounds = contentBounds();
            if (!bounds) return;
            setMenu({
                ...request,
                menuX: bounds.x + request.x,
                menuY: bounds.y + request.y,
            });
        });
        const offDownload = window.electron.on("browser:download", (download) => {
            setDownloads((prev) => {
                const next = prev.filter((row) => row.id !== download.id);
                return [download, ...next].slice(0, 8);
            });
        });
        const offBookmarks = window.electron.on("browser:bookmarks", (next) => {
            setBookmarks(next);
        });
        return () => {
            offState();
            offMenu();
            offDownload();
            offBookmarks();
        };
    }, [contentBounds]);

    useEffect(() => {
        if (!mode) return;
        let cancelled = false;
        void window.electron
            .invoke("browser:getBookmarks")
            .then((next) => {
                if (!cancelled) setBookmarks(next);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [mode]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: close the bubble whenever the page changes
    useEffect(() => {
        setBookmarkBubble(null);
    }, [state.activeId, state.url]);

    // biome-ignore lint/correctness/useExhaustiveDependencies: the address bar must refresh on tab switch even when two tabs share a URL
    useEffect(() => {
        if (!mode) return;
        const next = newTabPage ? "" : state.url || "";
        if (!addressFocused.current) setAddress(next);
    }, [state.url, state.activeId, mode, newTabPage]);

    useEffect(() => {
        if (mode) return;
        lastBounds.current = "";
        void window.electron.invoke("browser:setVisible", { visible: false });
    }, [mode]);

    const visible =
        Boolean(mode) &&
        !modalOverlayOpen &&
        !readerActive &&
        !menu &&
        !scanOpen &&
        !extensionsOpen &&
        !bookmarkBubble &&
        !downloaderOpen &&
        !videoOpen &&
        !trashOpen &&
        !mediaOpen;

    /* The React start page owns the content area for about:blank tabs. */
    const showNative = visible && !newTabPage;

    useEffect(() => {
        void window.electron.invoke("browser:setVisible", { visible: showNative });
        if (showNative) {
            lastBounds.current = "";
            requestAnimationFrame(syncBounds);
        }
    }, [showNative, syncBounds]);

    useLayoutEffect(() => {
        if (!mode) return;
        const element = contentRef.current;
        if (!element) return;
        const observer = new ResizeObserver(() => {
            lastBounds.current = "";
            syncBounds();
        });
        observer.observe(element);
        const onResize = () => {
            lastBounds.current = "";
            syncBounds();
        };
        window.addEventListener("resize", onResize);
        requestAnimationFrame(syncBounds);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", onResize);
        };
    }, [mode, syncBounds]);

    useEffect(() => {
        if (!readerActive || !mode) return;
        modeRef.current = null;
        setMode(null);
        setExtensionsOpen(false);
        setBookmarkBubble(null);
    }, [readerActive, mode]);

    useEffect(() => {
        if (!mode) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
                event.preventDefault();
                void openBookmarkBubble();
                return;
            }
            if (event.key !== "Escape") return;
            if (bookmarkBubble) {
                setBookmarkBubble(null);
                requestAnimationFrame(syncBounds);
                return;
            }
            if (extensionsOpen) {
                setExtensionsOpen(false);
                requestAnimationFrame(syncBounds);
                return;
            }
            if (scanOpen) {
                setScanOpen(false);
                setScanError("");
                setScanLoading(false);
                requestAnimationFrame(syncBounds);
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
            modeRef.current = null;
            setMode(null);
            setMenu(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [mode, scanOpen, extensionsOpen, bookmarkBubble, openBookmarkBubble, syncBounds]);

    const currentDisabled = activeTab ? disabledHosts.includes(hostOf(activeTab.url)) : false;
    const darkAvailable = Boolean(activeTab && hostOf(activeTab.url));
    const canUsePage = Boolean(activeTab?.url && activeTab.url !== "about:blank");
    const scanCountText = scanLoading
        ? "Scanning page…"
        : `${scanLinks.length} link${scanLinks.length === 1 ? "" : "s"} found · ${scanSelected.length} selected${
              scanFilter.trim() ? ` · ${filteredScanLinks.length} shown` : ""
          }`;

    const close = () => {
        modeRef.current = null;
        setMode(null);
        setMenu(null);
        setScanOpen(false);
        setExtensionsOpen(false);
        setBookmarkBubble(null);
    };

    const navigate = async () => {
        if (!state.activeId) return;
        setError("");
        const ok = await window.electron.invoke("browser:navigate", {
            id: state.activeId,
            input: address,
        });
        if (!ok) setError("Invalid URL or search query");
    };

    const openStartUrl = (url: string, newTab: boolean) => {
        setError("");
        void (async () => {
            if (!state.activeId || newTab) {
                await window.electron.invoke("browser:createTab", { url });
                return;
            }
            const ok = await window.electron.invoke("browser:navigate", { id: state.activeId, input: url });
            if (!ok) setError("Invalid URL or search query");
        })();
    };

    const searchFromStart = (input: string) => {
        const value = input.trim();
        if (!value) return;
        setError("");
        void (async () => {
            if (state.activeId) {
                const ok = await window.electron.invoke("browser:navigate", {
                    id: state.activeId,
                    input: value,
                });
                if (!ok) setError("Invalid URL or search query");
                return;
            }
            const { id } = await window.electron.invoke("browser:createTab", { url: "about:blank" });
            const ok = await window.electron.invoke("browser:navigate", { id, input: value });
            if (!ok) setError("Invalid URL or search query");
        })();
    };

    const addToDownloader = async (url: string) => {
        if (!url) return;
        const outDir = defaultOutDir || folders[0]?.path || window.electron.app.getPath("downloads");
        await window.electron.invoke("downloader:add", { url, outDir, keepFolder: false });
        openDownloader();
    };

    const closeScan = useCallback(() => {
        setScanOpen(false);
        setScanError("");
        setScanLoading(false);
        requestAnimationFrame(syncBounds);
    }, [syncBounds]);

    const closeExtensions = useCallback(() => {
        setExtensionsOpen(false);
        requestAnimationFrame(syncBounds);
    }, [syncBounds]);

    const closeBookmarkBubble = useCallback(() => {
        setBookmarkBubble(null);
        requestAnimationFrame(syncBounds);
    }, [syncBounds]);

    const scanPageLinks = async () => {
        setScanOpen(true);
        setMenu(null);
        setScanLinks([]);
        setScanSelected([]);
        setScanFilter("");
        setScanError("");
        if (!state.activeId) {
            setScanError("Open a page before scanning links");
            return;
        }

        setScanLoading(true);
        try {
            const links = await window.electron.invoke("browser:scanLinks", { tabId: state.activeId });
            setScanLinks(links);
            setScanSelected(links.map((link) => link.url));
        } catch (failure) {
            setScanError(failure instanceof Error ? failure.message : "Could not scan this page");
        } finally {
            setScanLoading(false);
        }
    };

    const toggleScanLink = (url: string) => {
        setScanSelected((prev) => {
            return prev.includes(url) ? prev.filter((row) => row !== url) : [...prev, url];
        });
    };

    const selectAllScanned = () => {
        setScanSelected((prev) => [...new Set([...prev, ...filteredScanLinks.map((link) => link.url)])]);
    };

    const addScannedLinks = async () => {
        const urls = scanLinks.filter((link) => scanSelected.includes(link.url)).map((link) => link.url);
        if (urls.length === 0) {
            setScanError("Select at least one link");
            return;
        }

        setScanLoading(true);
        setScanError("");
        const outDir = defaultOutDir || folders[0]?.path || window.electron.app.getPath("downloads");

        const queued = new Set<string>();
        try {
            const downloaderState = await window.electron.invoke("downloader:getState");
            for (const job of downloaderState.jobs) {
                if (
                    job.status === "queued" ||
                    job.status === "resolving" ||
                    job.status === "downloading" ||
                    job.status === "packing"
                ) {
                    queued.add(job.url);
                }
            }
        } catch {
            // If the queue state is unavailable, still try to add the links.
        }

        let added = 0;
        const failed: string[] = [];
        for (const url of urls) {
            if (queued.has(url)) continue;
            try {
                await window.electron.invoke("downloader:add", { url, outDir, keepFolder: false });
                added += 1;
            } catch {
                failed.push(url);
            }
        }

        setScanLoading(false);
        if (added === 0 && failed.length === 0) {
            setScanError("All selected links are already in the Downloader");
            return;
        }

        openDownloader();
        closeScan();
        if (failed.length > 0) {
            setError(`${failed.length} link(s) could not be added to the Downloader`);
        }
    };

    const changeEngine = (next: BrowserSearchEngine) => {
        setEngine(next);
        window.localStorage.setItem("yokomura-browser-engine", next);
        void window.electron.invoke("browser:setSearchEngine", { engine: next });
    };

    const toggleDarkForSite = () => {
        if (!activeTab) return;
        const host = hostOf(activeTab.url);
        if (!host) return;
        const nextHosts = currentDisabled ? disabledHosts.filter((row) => row !== host) : [...disabledHosts, host];
        setDisabledHosts(nextHosts);
        window.localStorage.setItem("yokomura-browser-disabled-hosts", JSON.stringify(nextHosts));
        void window.electron.invoke("browser:setHostForceDark", {
            hostOrUrl: host,
            enabled: currentDisabled,
        });
    };

    const toggleAdblock = () => {
        const next = !adblockEnabled;
        setAdblockEnabled(next);
        window.localStorage.setItem("yokomura-browser-adblock", next ? "on" : "off");
        void window.electron.invoke("browser:setAdblock", { enabled: next });
    };

    const saveBookmarkTitle = async (title: string) => {
        const current = bookmarkBubble;
        if (!current) return;
        try {
            const updated = await window.electron.invoke("browser:updateBookmark", {
                id: current.bookmark.id,
                title,
            });
            if (updated) {
                setBookmarks((previous) =>
                    previous.map((bookmark) => (bookmark.id === updated.id ? updated : bookmark)),
                );
            }
            setBookmarkBubble(null);
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not rename this bookmark");
        }
    };

    const removeBookmarkById = async (id: string) => {
        try {
            const removed = await window.electron.invoke("browser:removeBookmark", { id });
            if (removed) {
                setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id));
            }
            setBookmarkBubble((previous) => (previous?.bookmark.id === id ? null : previous));
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not remove this bookmark");
        }
    };

    const togglePinnedTool = (id: BrowserToolId) => {
        const next = pinnedTools.includes(id)
            ? pinnedTools.filter((toolId) => toolId !== id)
            : [...pinnedTools, id];
        const normalized = normalizePinnedToolIds(next);
        setPinnedTools(normalized);
        savePinnedToolIds(normalized);
    };

    const resetPinnedTools = () => {
        const defaults = [...DEFAULT_PINNED_TOOL_IDS];
        setPinnedTools(defaults);
        savePinnedToolIds(defaults);
    };

    const closeMenu = () => {
        setMenu(null);
        requestAnimationFrame(syncBounds);
    };

    const contextAction = async (action: "open" | "new-tab" | "copy" | "download" | "external") => {
        if (!menu) return;
        const url = menu.linkURL || menu.pageURL;
        if (action === "open" && menu.linkURL) {
            await window.electron.invoke("browser:navigate", { id: menu.tabId, input: menu.linkURL });
        } else if (action === "new-tab" && menu.linkURL) {
            await window.electron.invoke("browser:createTab", { url: menu.linkURL });
        } else if (action === "copy" && url) {
            await window.electron.clipboard.writeText(url);
        } else if (action === "download" && url) {
            await addToDownloader(url);
        } else if (action === "external" && url) {
            void window.electron.openExternal(url);
        }
        closeMenu();
    };

    const toolEntries: BrowserToolEntry[] = BROWSER_TOOLS.map((definition) => {
        const pinned = pinnedTools.includes(definition.id);
        if (definition.id === "bookmark") {
            return {
                ...definition,
                label: activeBookmark ? "Edit bookmark" : definition.label,
                description: activeBookmark ? "Rename or remove this saved page." : definition.description,
                pinned,
                active: Boolean(activeBookmark),
                disabled: !bookmarkable,
                onAction: () => {
                    setExtensionsOpen(false);
                    void openBookmarkBubble();
                },
            };
        }
        if (definition.id === "forceDark") {
            return {
                ...definition,
                pinned,
                active: darkAvailable && !currentDisabled,
                disabled: !darkAvailable,
                description: !darkAvailable
                    ? "Open a page first."
                    : currentDisabled
                      ? "Disabled for this site."
                      : "Forced dark is on.",
                onAction: toggleDarkForSite,
            };
        }
        if (definition.id === "adblock") {
            return {
                ...definition,
                pinned,
                active: adblockEnabled,
                disabled: false,
                onAction: toggleAdblock,
            };
        }
        if (definition.id === "download") {
            return {
                ...definition,
                pinned,
                active: false,
                disabled: !canUsePage,
                onAction: () => {
                    closeExtensions();
                    void addToDownloader(activeTab?.url ?? "");
                },
            };
        }
        if (definition.id === "scan") {
            return {
                ...definition,
                pinned,
                active: false,
                disabled: !canUsePage,
                onAction: () => {
                    closeExtensions();
                    void scanPageLinks();
                },
            };
        }
        return {
            ...definition,
            pinned,
            active: false,
            disabled: !canUsePage,
            onAction: () => {
                closeExtensions();
                if (activeTab?.url) void window.electron.openExternal(activeTab.url);
            },
        };
    });

    const pinnedRightTools = pinnedTools.filter((id) => id !== "bookmark");

    const renderToolTile = (id: BrowserToolId) => {
        if (id === "forceDark") {
            return (
                <button
                    type="button"
                    className={`browserToolTile ${darkAvailable && !currentDisabled ? "is-on" : ""}`}
                    data-tool="forceDark"
                    title={currentDisabled ? "Enable dark for this site" : "Disable dark for this site"}
                    aria-label="Toggle dark mode for this site"
                    aria-pressed={darkAvailable && !currentDisabled}
                    disabled={!darkAvailable}
                    onClick={toggleDarkForSite}
                >
                    <FontAwesomeIcon icon={currentDisabled ? faSun : faMoon} />
                </button>
            );
        }
        if (id === "adblock") {
            return (
                <button
                    type="button"
                    className={`browserToolTile ${adblockEnabled ? "is-on" : ""}`}
                    data-tool="adblock"
                    title={
                        adblockEnabled ? "Ad blocking on (click to disable)" : "Ad blocking off (click to enable)"
                    }
                    aria-pressed={adblockEnabled}
                    onClick={toggleAdblock}
                >
                    <FontAwesomeIcon icon={adblockEnabled ? faShield : faShieldHalved} />
                </button>
            );
        }
        if (id === "download") {
            return (
                <button
                    type="button"
                    className="browserToolTile"
                    data-tool="download"
                    title="Add current page to Downloader"
                    disabled={!canUsePage}
                    onClick={() => void addToDownloader(activeTab?.url ?? "")}
                >
                    <FontAwesomeIcon icon={faDownload} />
                </button>
            );
        }
        if (id === "scan") {
            return (
                <button
                    type="button"
                    className="browserToolTile is-secondary"
                    data-tool="scan"
                    title="Scan links on this page"
                    disabled={!canUsePage}
                    onClick={() => void scanPageLinks()}
                >
                    <FontAwesomeIcon icon={faLink} />
                </button>
            );
        }
        if (id === "external") {
            return (
                <button
                    type="button"
                    className="browserToolTile is-secondary"
                    data-tool="external"
                    title="Open in default browser"
                    disabled={!canUsePage}
                    onClick={() => activeTab?.url && void window.electron.openExternal(activeTab.url)}
                >
                    <FontAwesomeIcon icon={faUpRightFromSquare} />
                </button>
            );
        }
        return null;
    };

    if (!mode) return null;

    return (
        <div className={`browserHost is-${mode}`} ref={paneRef}>
            {mode === "side" ? (
                <div
                    className="browserSideResizer"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        const startX = event.clientX;
                        const startWidth = sideWidth;
                        const move = (moveEvent: MouseEvent) => {
                            setSideWidth(Math.max(320, Math.min(760, startWidth + startX - moveEvent.clientX)));
                        };
                        const up = () => {
                            window.removeEventListener("mousemove", move);
                            window.removeEventListener("mouseup", up);
                        };
                        window.addEventListener("mousemove", move);
                        window.addEventListener("mouseup", up);
                    }}
                />
            ) : null}
            <div className="browserPane" style={mode === "side" ? { width: sideWidth } : undefined}>
                <div className="browserTabStrip">
                    <div className="browserTabs" role="tablist">
                        {state.tabs.map((tab) => (
                            <div
                                key={tab.id}
                                className={`browserTab ${tab.id === state.activeId ? "is-active" : ""}`}
                                role="tab"
                                aria-selected={tab.id === state.activeId}
                                tabIndex={tab.id === state.activeId ? 0 : -1}
                                onClick={() => void window.electron.invoke("browser:activateTab", { id: tab.id })}
                                onKeyDown={(event) => {
                                    if (event.key !== "Enter" && event.key !== " ") return;
                                    event.preventDefault();
                                    void window.electron.invoke("browser:activateTab", { id: tab.id });
                                }}
                                title={tab.url === "about:blank" || !tab.url ? "New Tab" : tab.title || tab.url}
                            >
                                {tab.favicon ? (
                                    <img src={tab.favicon} alt="" draggable={false} />
                                ) : (
                                    <FontAwesomeIcon icon={faGlobe} />
                                )}
                                <span>
                                    {tab.url === "about:blank" || !tab.url ? "New Tab" : tab.title || tab.url}
                                </span>
                                {tab.loading ? <span className="browserTabLoading" /> : null}
                                <button
                                    type="button"
                                    tabIndex={-1}
                                    className="browserTabClose"
                                    aria-label="Close tab"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void window.electron.invoke("browser:closeTab", { id: tab.id });
                                    }}
                                >
                                    <FontAwesomeIcon icon={faXmark} />
                                </button>
                            </div>
                        ))}
                    </div>
                    <button
                        type="button"
                        className="browserIconBtn browserNewTab"
                        title="New tab"
                        onClick={() => void window.electron.invoke("browser:createTab", { url: "about:blank" })}
                    >
                        <FontAwesomeIcon icon={faPlus} />
                    </button>
                    <button type="button" className="browserIconBtn" title="Close browser" onClick={close}>
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>

                <div className="browserToolbar">
                    <button
                        type="button"
                        className="browserIconBtn"
                        disabled={!state.canGoBack}
                        onClick={() =>
                            state.activeId && void window.electron.invoke("browser:back", { id: state.activeId })
                        }
                    >
                        <FontAwesomeIcon icon={faArrowLeft} />
                    </button>
                    <button
                        type="button"
                        className="browserIconBtn"
                        disabled={!state.canGoForward}
                        onClick={() =>
                            state.activeId &&
                            void window.electron.invoke("browser:forward", { id: state.activeId })
                        }
                    >
                        <FontAwesomeIcon icon={faArrowRight} />
                    </button>
                    <button
                        type="button"
                        className="browserIconBtn"
                        onClick={() =>
                            state.activeId &&
                            void window.electron.invoke(state.loading ? "browser:stop" : "browser:reload", {
                                id: state.activeId,
                            })
                        }
                    >
                        <FontAwesomeIcon icon={state.loading ? faXmark : faRotate} />
                    </button>
                    {pinnedTools.includes("bookmark") ? (
                        <button
                            type="button"
                            className={`browserToolTile browserBookmarkBtn ${activeBookmark ? "is-on" : ""}`}
                            data-tool="bookmark"
                            title={activeBookmark ? "Edit bookmark" : "Bookmark this tab (Ctrl+D)"}
                            aria-label={activeBookmark ? "Edit bookmark" : "Bookmark this tab"}
                            aria-pressed={Boolean(activeBookmark)}
                            disabled={!bookmarkable}
                            onClick={() => void openBookmarkBubble()}
                        >
                            <FontAwesomeIcon icon={activeBookmark ? faBookmarkSolid : faBookmarkRegular} />
                        </button>
                    ) : null}
                    <input
                        className="browserAddress"
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                        onFocus={(event) => {
                            addressFocused.current = true;
                            event.currentTarget.select();
                        }}
                        onBlur={() => {
                            addressFocused.current = false;
                        }}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                void navigate();
                            }
                            if (event.key === "Escape") {
                                event.currentTarget.blur();
                            }
                        }}
                        placeholder="Search Brave or enter URL"
                        spellCheck={false}
                    />
                    <select
                        className="browserEngine"
                        value={engine}
                        onChange={(event) => changeEngine(event.currentTarget.value as BrowserSearchEngine)}
                        title="Search engine"
                    >
                        <option value="brave">Brave</option>
                        <option value="google">Google</option>
                        <option value="duckduckgo">DuckDuckGo</option>
                    </select>
                    {pinnedRightTools.length > 0 ? <div className="browserToolbarDivider" aria-hidden /> : null}
                    {pinnedRightTools.map((id) => (
                        <Fragment key={id}>{renderToolTile(id)}</Fragment>
                    ))}
                    <div className="browserToolbarDivider" aria-hidden />
                    <button
                        type="button"
                        className={`browserToolTile browserExtensionsBtn ${extensionsOpen ? "is-open" : ""}`}
                        title="Extensions"
                        aria-label="Extensions"
                        aria-haspopup="dialog"
                        aria-expanded={extensionsOpen}
                        onClick={() => {
                            setMenu(null);
                            setScanOpen(false);
                            setBookmarkBubble(null);
                            setExtensionsOpen((previous) => !previous);
                        }}
                    >
                        <FontAwesomeIcon icon={faPuzzlePiece} />
                    </button>
                    {extensionsOpen ? (
                        <BrowserExtensionsMenu
                            engine={engine}
                            onEngineChange={changeEngine}
                            tools={toolEntries}
                            onTogglePin={togglePinnedTool}
                            onResetPins={resetPinnedTools}
                            onClose={closeExtensions}
                        />
                    ) : null}
                    {bookmarkBubble ? (
                        <BrowserBookmarkBubble
                            bookmark={bookmarkBubble.bookmark}
                            created={bookmarkBubble.created}
                            onSave={(title) => void saveBookmarkTitle(title)}
                            onRemove={() => void removeBookmarkById(bookmarkBubble.bookmark.id)}
                            onClose={closeBookmarkBubble}
                        />
                    ) : null}
                </div>

                {error ? <div className="browserError">{error}</div> : null}
                <div className="browserContent" ref={contentRef}>
                    {newTabPage ? (
                        <BrowserStartPage
                            engine={engine}
                            bookmarks={bookmarks}
                            onOpenUrl={openStartUrl}
                            onSearch={searchFromStart}
                            onRemoveBookmark={(id) => void removeBookmarkById(id)}
                        />
                    ) : (
                        <div className="browserContentFallback">
                            <FontAwesomeIcon icon={faGlobe} />
                            <span>{state.loading ? "Loading…" : "Browser"}</span>
                        </div>
                    )}
                </div>

                {downloads.length > 0 ? (
                    <div className="browserDownloads">
                        {downloads.slice(0, 2).map((download) => (
                            <div key={download.id}>
                                <span title={download.savePath}>{download.filename}</span>
                                <span>
                                    {download.state === "completed"
                                        ? "Done"
                                        : download.total > 0
                                          ? `${Math.round((download.received / download.total) * 100)}%`
                                          : download.state}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : null}

                {scanOpen ? (
                    <div
                        className="browserScanOverlay"
                        onMouseDown={(event) => {
                            if (event.target === event.currentTarget) closeScan();
                        }}
                    >
                        <div className="browserScanDialog" role="dialog" aria-modal="true" aria-label="Scan links">
                            <div className="browserScanHeader">
                                <strong>Scan links</strong>
                                <button
                                    type="button"
                                    className="browserIconBtn"
                                    title="Close"
                                    aria-label="Close"
                                    onClick={closeScan}
                                >
                                    <FontAwesomeIcon icon={faXmark} />
                                </button>
                            </div>

                            <div className="browserScanControls">
                                <input
                                    className="browserScanFilter"
                                    value={scanFilter}
                                    onChange={(event) => setScanFilter(event.target.value)}
                                    placeholder="Filter links"
                                    spellCheck={false}
                                    // biome-ignore lint/a11y/noAutofocus: the drawer is opened by an explicit toolbar action
                                    autoFocus
                                />
                                <button
                                    type="button"
                                    className="browserScanAction"
                                    disabled={filteredScanLinks.length === 0}
                                    onClick={selectAllScanned}
                                >
                                    Select all
                                </button>
                                <button
                                    type="button"
                                    className="browserScanAction"
                                    disabled={scanSelected.length === 0}
                                    onClick={() => setScanSelected([])}
                                >
                                    Clear
                                </button>
                            </div>

                            <div className="browserScanCount">{scanCountText}</div>

                            {scanError ? <div className="browserScanError">{scanError}</div> : null}

                            <div className="browserScanList">
                                {scanLoading ? (
                                    <div className="browserScanEmpty">Scanning page…</div>
                                ) : filteredScanLinks.length === 0 ? (
                                    <div className="browserScanEmpty">
                                        {scanLinks.length === 0
                                            ? "No links found on this page."
                                            : "No links match the filter."}
                                    </div>
                                ) : (
                                    filteredScanLinks.map((link) => (
                                        <label key={link.url} className="browserScanRow" title={link.url}>
                                            <input
                                                type="checkbox"
                                                checked={scanSelected.includes(link.url)}
                                                onChange={() => toggleScanLink(link.url)}
                                            />
                                            <span className="browserScanText">{link.text || link.url}</span>
                                            <span className="browserScanUrl">{link.url}</span>
                                        </label>
                                    ))
                                )}
                            </div>

                            <div className="browserScanFooter">
                                <button
                                    type="button"
                                    className="browserScanPrimary"
                                    disabled={scanLoading || scanSelected.length === 0}
                                    onClick={() => void addScannedLinks()}
                                >
                                    Add selected to Downloader
                                </button>
                                <button type="button" className="browserScanAction" onClick={closeScan}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {menu ? (
                    <div
                        className="browserContextMenu"
                        style={{ left: menu.menuX, top: menu.menuY }}
                        onMouseLeave={closeMenu}
                    >
                        {menu.linkURL ? (
                            <>
                                <button type="button" onClick={() => void contextAction("open")}>
                                    Open link
                                </button>
                                <button type="button" onClick={() => void contextAction("new-tab")}>
                                    Open in new tab
                                </button>
                                <button type="button" onClick={() => void contextAction("copy")}>
                                    Copy link
                                </button>
                                <button type="button" onClick={() => void contextAction("download")}>
                                    Add to Downloader
                                </button>
                            </>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    onClick={() => {
                                        closeMenu();
                                        if (activeBookmark) {
                                            void removeBookmarkById(activeBookmark.id);
                                        } else {
                                            void openBookmarkBubble();
                                        }
                                    }}
                                >
                                    {activeBookmark ? "Remove bookmark" : "Bookmark this page"}
                                </button>
                                <button type="button" onClick={() => void contextAction("download")}>
                                    Add page to Downloader
                                </button>
                                <button type="button" onClick={() => void contextAction("copy")}>
                                    Copy page URL
                                </button>
                            </>
                        )}
                        <button type="button" onClick={() => void contextAction("external")}>
                            Open in default browser
                        </button>
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default BrowserHost;
