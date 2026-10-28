import type {
    BrowserBookmark,
    BrowserContextMenuRequest,
    BrowserDownload,
    BrowserScannedLink,
    BrowserSearchEngine,
    BrowserState,
} from "@common/types/browser";
import { buildDownloadFeed } from "@features/downloader/downloadFeed";
import {
    DOWNLOAD_HISTORY_EVENT,
    type DownloadHistoryEntry,
    readDownloadHistory,
} from "@features/downloader/downloadHistory";
import {
    type DownloadFileKind,
    downloadFileKind,
    downloadProgressPercent,
    formatDownloadMeta,
} from "@features/downloader/downloadPresentation";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faBookmark as faBookmarkRegular } from "@fortawesome/free-regular-svg-icons";
import {
    faArrowLeft,
    faArrowRight,
    faBookmark as faBookmarkSolid,
    faDownload,
    faFile,
    faFileImage,
    faFileLines,
    faFileZipper,
    faFilm,
    faFolderOpen,
    faGlobe,
    faLink,
    faPlus,
    faPuzzlePiece,
    faRotate,
    faShield,
    faShieldHalved,
    faUpRightFromSquare,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppContext } from "@renderer/App";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { requestSettingsNav, selectModalOverlayOpen } from "@store/ui";
import {
    type CSSProperties,
    Fragment,
    type ReactElement,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";
import BrowserBookmarkBubble, { type BookmarkBubbleDraft } from "./BrowserBookmarkBubble";
import BrowserExtensionsMenu, { type BrowserToolEntry } from "./BrowserExtensionsMenu";
import BrowserStartPage from "./BrowserStartPage";
import {
    bookmarkCategories,
    canonicalCategoryName,
    readLastBookmarkCategory,
    saveLastBookmarkCategory,
} from "./browserBookmarks";
import { DISABLED_HOSTS_EVENT, publishDisabledHosts, readDisabledHosts, readForceDark } from "./browserDarkMode";
import { applyBrowserEngine, BROWSER_ENGINE_EVENT, ENGINE_LABEL, readBrowserEngine } from "./browserEngine";
import type { BrowserMode, ToggleBrowserDetail } from "./browserEvents";
import {
    BROWSER_TOOLS,
    type BrowserToolId,
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

const DOWNLOADS_SEEN_KEY = "yomikura-browser-downloads-seen-at";

const DOWNLOAD_KIND_ICON: Record<DownloadFileKind, IconDefinition> = {
    video: faFilm,
    archive: faFileZipper,
    image: faFileImage,
    document: faFileLines,
    executable: faFile,
    other: faFile,
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

/** Ad blocking defaults to on; localStorage stores "off" when disabled. */
const readSavedAdblock = (): boolean => {
    return window.localStorage.getItem("yokomura-browser-adblock") !== "off";
};

/**
 * React shell for the native WebContentsView browser. The native view sits over
 * `.browserContent`; tabs/toolbar/menus stay in the renderer.
 */
const BrowserHost = () => {
    const { openDownloader, openDownloadHistory, downloaderOpen, videoOpen, trashOpen, mediaOpen } =
        useAppContext();
    const dispatch = useAppDispatch();
    const defaultOutDir = useAppSelector((store) => {
        const folder = store.mainSettings.library.folders.find((row) => row.isDefaultLocation);
        return folder?.path ?? "";
    });
    const modalOverlayOpen = useAppSelector(selectModalOverlayOpen);

    const [mode, setMode] = useState<BrowserMode | null>(null);
    const [state, setState] = useState<BrowserState>(EMPTY_STATE);
    const newTabPage = !state.activeId || !state.url || state.url === "about:blank";
    const [address, setAddress] = useState("");
    const [engine, setEngine] = useState<BrowserSearchEngine>(readBrowserEngine);
    const [sideWidth, setSideWidth] = useState(460);
    const [snapshot, setSnapshot] = useState("");
    const [disabledHosts, setDisabledHosts] = useState<string[]>(readDisabledHosts);
    const [menu, setMenu] = useState<ContextMenuState | null>(null);
    const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
    const [downloadsOpen, setDownloadsOpen] = useState(false);
    const [downloadsPos, setDownloadsPos] = useState<{ top: number; right: number } | null>(null);
    const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryEntry[]>(readDownloadHistory);
    const [downloadsSeenAt, setDownloadsSeenAt] = useState<number>(() => {
        const stored = Number(window.localStorage.getItem(DOWNLOADS_SEEN_KEY));
        return Number.isFinite(stored) && stored > 0 ? stored : Date.now();
    });
    const [downloadsNowTick, setDownloadsNowTick] = useState(() => Date.now());
    const [error, setError] = useState("");
    const [scanOpen, setScanOpen] = useState(false);
    const [scanLoading, setScanLoading] = useState(false);
    const [scanLinks, setScanLinks] = useState<BrowserScannedLink[]>([]);
    const [scanSelected, setScanSelected] = useState<string[]>([]);
    const [scanFilter, setScanFilter] = useState("");
    const [scanError, setScanError] = useState("");
    const [extensionsOpen, setExtensionsOpen] = useState(false);
    const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([]);
    const [bookmarkBubble, setBookmarkBubble] = useState<BookmarkBubbleDraft | null>(null);
    const [pinnedTools, setPinnedTools] = useState<BrowserToolId[]>(readPinnedToolIds);
    const [adblockEnabled, setAdblockEnabled] = useState<boolean>(readSavedAdblock);
    const modeRef = useRef<BrowserMode | null>(null);
    const paneRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastBounds = useRef("");
    const addressFocused = useRef(false);
    const downloadsButtonRef = useRef<HTMLButtonElement>(null);
    const overlayOpenRef = useRef(false);
    overlayOpenRef.current = Boolean(menu || downloadsOpen);

    const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
    const activeBookmark = useMemo(
        () =>
            activeTab?.url ? bookmarks.find((bookmark) => samePageUrl(bookmark.url, activeTab.url)) : undefined,
        [bookmarks, activeTab?.url],
    );
    const bookmarkCategoryOptions = useMemo(() => bookmarkCategories(bookmarks), [bookmarks]);
    const bookmarkable = isBookmarkableUrl(activeTab?.url);

    useEffect(() => {
        const sync = () => setDownloadHistory(readDownloadHistory());
        window.addEventListener(DOWNLOAD_HISTORY_EVENT, sync);
        return () => window.removeEventListener(DOWNLOAD_HISTORY_EVENT, sync);
    }, []);

    useEffect(() => {
        if (!downloadsOpen) return;
        setDownloadHistory(readDownloadHistory());
        setDownloadsNowTick(Date.now());
        const tick = window.setInterval(() => setDownloadsNowTick(Date.now()), 30_000);
        return () => window.clearInterval(tick);
    }, [downloadsOpen]);

    useLayoutEffect(() => {
        if (!downloadsOpen) return;
        const updatePosition = () => {
            const rect = downloadsButtonRef.current?.getBoundingClientRect();
            if (!rect) return;
            setDownloadsPos({
                top: rect.bottom + 8,
                right: Math.max(12, window.innerWidth - rect.right),
            });
        };
        updatePosition();
        window.addEventListener("resize", updatePosition);
        return () => window.removeEventListener("resize", updatePosition);
    }, [downloadsOpen]);

    const downloadRows = useMemo(
        () => buildDownloadFeed(downloads, downloadHistory),
        [downloads, downloadHistory],
    );
    const activeDownloadRows = useMemo(
        () => downloadRows.filter((row) => row.status === "progressing"),
        [downloadRows],
    );
    const downloadRingPercent = useMemo(() => {
        const total = activeDownloadRows.reduce((sum, row) => sum + Math.max(0, row.total), 0);
        if (total <= 0) return null;
        const received = activeDownloadRows.reduce((sum, row) => sum + Math.max(0, row.received), 0);
        return Math.max(0, Math.min(100, Math.round((received / total) * 100)));
    }, [activeDownloadRows]);
    const hasUnseenDownloads =
        !downloadsOpen && downloadHistory.some((entry) => entry.finishedAt > downloadsSeenAt);

    /** Freezes the page behind React menus; the native view is hidden while they are open. */
    const capturePageSnapshot = useCallback(
        async (timeoutMs = 5000): Promise<string> => {
            if (newTabPage) return "";
            if (snapshot) return snapshot;
            try {
                const image = await Promise.race([
                    window.electron.invoke("browser:capturePage", {}),
                    new Promise<string>((resolve) => window.setTimeout(() => resolve(""), timeoutMs)),
                ]);
                if (image) setSnapshot(image);
                return image;
            } catch {
                return "";
            }
        },
        [newTabPage, snapshot],
    );

    const openBookmarkBubble = useCallback(async () => {
        const tab = activeTab;
        if (!tab || !isBookmarkableUrl(tab.url)) return;
        await capturePageSnapshot();
        setMenu(null);
        setDownloadsOpen(false);
        setExtensionsOpen(false);
        setScanOpen(false);
        if (activeBookmark) {
            setBookmarkBubble({
                mode: "edit",
                bookmarkId: activeBookmark.id,
                url: activeBookmark.url,
                title: activeBookmark.title,
                favicon: activeBookmark.favicon,
                category: activeBookmark.category,
            });
            return;
        }

        setBookmarkBubble({
            mode: "new",
            url: tab.url,
            title: tab.title || hostOf(tab.url),
            favicon: tab.favicon,
            category: readLastBookmarkCategory(),
        });
    }, [activeBookmark, activeTab, capturePageSnapshot]);

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

    useLayoutEffect(() => {
        const body = document.body;
        const open = mode === "side";
        body.classList.toggle("browserSideOpen", open);
        if (open) body.style.setProperty("--browser-side-width", `${sideWidth + 6}px`);
        else body.style.removeProperty("--browser-side-width");
        return () => {
            body.classList.remove("browserSideOpen");
            body.style.removeProperty("--browser-side-width");
        };
    }, [mode, sideWidth]);

    useEffect(() => {
        const onEngineChange = (event: Event) => {
            const detail = (event as CustomEvent<{ engine?: BrowserSearchEngine }>).detail;
            if (detail?.engine) setEngine(detail.engine);
        };
        window.addEventListener(BROWSER_ENGINE_EVENT, onEngineChange);
        return () => window.removeEventListener(BROWSER_ENGINE_EVENT, onEngineChange);
    }, []);

    useEffect(() => {
        const onHostsChange = (event: Event) => {
            const detail = (event as CustomEvent<{ hosts?: string[] }>).detail;
            if (Array.isArray(detail?.hosts)) setDisabledHosts(detail.hosts);
        };
        window.addEventListener(DISABLED_HOSTS_EVENT, onHostsChange);
        return () => window.removeEventListener(DISABLED_HOSTS_EVENT, onHostsChange);
    }, []);

    /* Keep automatic browser downloads inside the current Default Location. */
    useEffect(() => {
        if (!mode || !defaultOutDir) return;
        void window.electron.invoke("browser:setDownloadDir", { dir: defaultOutDir });
    }, [mode, defaultOutDir]);

    useEffect(() => {
        const onToggle = (event: Event) => {
            const detail = (event as CustomEvent<ToggleBrowserDetail>).detail;
            if (!detail?.mode) return;
            const current = modeRef.current;
            const next = current === null ? detail.mode : current === detail.mode ? null : detail.mode;
            modeRef.current = next;
            setMode(next);
            setMenu(null);
            setDownloadsOpen(false);
            setExtensionsOpen(false);
            setBookmarkBubble(null);
            if (!next) return;

            const saved = readBrowserEngine();
            setEngine(saved);
            void window.electron.invoke("browser:setSearchEngine", { engine: saved });
            const savedAdblock = readSavedAdblock();
            setAdblockEnabled(savedAdblock);
            void window.electron.invoke("browser:setAdblock", { enabled: savedAdblock });
            void window.electron.invoke("browser:setForceDark", { enabled: readForceDark() });
            for (const host of readDisabledHosts()) {
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
        const onClose = () => {
            modeRef.current = null;
            setMode(null);
            setMenu(null);
            setDownloadsOpen(false);
            setScanOpen(false);
            setExtensionsOpen(false);
            setBookmarkBubble(null);
            setSnapshot("");
        };
        window.addEventListener("yokomura:close-browser", onClose);
        return () => window.removeEventListener("yokomura:close-browser", onClose);
    }, []);

    useEffect(() => {
        const offState = window.electron.on("browser:state", (next) => {
            setState(next);
            setError("");
        });
        const offMenu = window.electron.on("browser:contextMenu", (request) => {
            const bounds = contentBounds();
            if (!bounds) return;
            void (async () => {
                await capturePageSnapshot();
                setDownloadsOpen(false);
                setMenu({
                    ...request,
                    menuX: bounds.x + request.x,
                    menuY: bounds.y + request.y,
                });
            })();
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
    }, [contentBounds, capturePageSnapshot]);

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
        setSnapshot("");
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
        !menu &&
        !downloadsOpen &&
        !scanOpen &&
        !extensionsOpen &&
        !bookmarkBubble &&
        !(mode === "full" && (videoOpen || trashOpen || mediaOpen)) &&
        !(mode === "side" && downloaderOpen);

    /* The React start page owns the content area for about:blank tabs. */
    const showNative = visible && !newTabPage;
    const overlayOpen = Boolean(menu || downloadsOpen || scanOpen || extensionsOpen || bookmarkBubble);

    useEffect(() => {
        let cancelled = false;
        void window.electron.invoke("browser:setVisible", { visible: showNative }).then(() => {
            if (cancelled || !showNative || overlayOpenRef.current) return;
            // Keep the frozen frame until Chromium has shown the native view again.
            setSnapshot("");
        });
        if (showNative) {
            lastBounds.current = "";
            requestAnimationFrame(syncBounds);
        }
        return () => {
            cancelled = true;
        };
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
        if (!mode) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d") {
                event.preventDefault();
                void openBookmarkBubble();
                return;
            }
            if (event.key !== "Escape") return;
            if (modalOverlayOpen || mediaOpen || trashOpen || downloaderOpen || videoOpen) return;
            if (downloadsOpen) {
                setDownloadsOpen(false);
                return;
            }
            if (menu) {
                setMenu(null);
                return;
            }
            if (bookmarkBubble) {
                setBookmarkBubble(null);
                setSnapshot("");
                requestAnimationFrame(syncBounds);
                return;
            }
            if (extensionsOpen) {
                setExtensionsOpen(false);
                setSnapshot("");
                requestAnimationFrame(syncBounds);
                return;
            }
            if (scanOpen) {
                setScanOpen(false);
                setScanError("");
                setScanLoading(false);
                setSnapshot("");
                requestAnimationFrame(syncBounds);
                return;
            }
            const target = event.target as HTMLElement | null;
            if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
            modeRef.current = null;
            setMode(null);
            setMenu(null);
            setExtensionsOpen(false);
            setBookmarkBubble(null);
            setSnapshot("");
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [
        mode,
        scanOpen,
        extensionsOpen,
        bookmarkBubble,
        menu,
        downloadsOpen,
        openBookmarkBubble,
        syncBounds,
        modalOverlayOpen,
        mediaOpen,
        trashOpen,
        downloaderOpen,
        videoOpen,
    ]);

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
        setDownloadsOpen(false);
        setScanOpen(false);
        setExtensionsOpen(false);
        setBookmarkBubble(null);
        setSnapshot("");
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

    const addToDownloader = (url: string) => {
        if (!url) return;
        /* Prefill only: the user reviews the folder and presses Add to queue. */
        closeExtensions();
        openDownloader(url);
    };

    const closeScan = useCallback(() => {
        setScanOpen(false);
        setScanError("");
        setScanLoading(false);
        setSnapshot("");
        requestAnimationFrame(syncBounds);
    }, [syncBounds]);

    const closeExtensions = useCallback(() => {
        setExtensionsOpen(false);
        setSnapshot("");
        requestAnimationFrame(syncBounds);
    }, [syncBounds]);

    const closeBookmarkBubble = useCallback(() => {
        setBookmarkBubble(null);
        setSnapshot("");
        requestAnimationFrame(syncBounds);
    }, [syncBounds]);

    const toggleExtensions = async () => {
        if (extensionsOpen) {
            closeExtensions();
            return;
        }
        await capturePageSnapshot();
        setMenu(null);
        setDownloadsOpen(false);
        setScanOpen(false);
        setBookmarkBubble(null);
        setExtensionsOpen(true);
    };

    const scanPageLinks = async () => {
        await capturePageSnapshot();
        setScanOpen(true);
        setMenu(null);
        setDownloadsOpen(false);
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

    const addScannedLinks = () => {
        const urls = scanLinks.filter((link) => scanSelected.includes(link.url)).map((link) => link.url);
        if (urls.length === 0) {
            setScanError("Select at least one link");
            return;
        }

        /* Prefill only; queueing happens after the user reviews the panel. */
        closeScan();
        openDownloader(urls.join("\n"));
    };

    const changeEngine = (next: BrowserSearchEngine) => {
        applyBrowserEngine(next);
        setEngine(next);
    };

    const toggleDarkForSite = () => {
        if (!activeTab) return;
        const host = hostOf(activeTab.url);
        if (!host) return;
        const nextHosts = currentDisabled ? disabledHosts.filter((row) => row !== host) : [...disabledHosts, host];
        setDisabledHosts(nextHosts);
        publishDisabledHosts(nextHosts);
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

    const saveBookmarkDraft = async (values: { title: string; category: string }) => {
        const current = bookmarkBubble;
        if (!current) return;
        const category = canonicalCategoryName(values.category, bookmarkCategoryOptions);
        try {
            if (current.mode === "new") {
                const created = await window.electron.invoke("browser:addBookmark", {
                    url: current.url,
                    title: values.title,
                    favicon: current.favicon,
                    category,
                });
                if (created) {
                    setBookmarks((previous) => [
                        created,
                        ...previous.filter((bookmark) => bookmark.id !== created.id),
                    ]);
                }
            } else if (current.bookmarkId) {
                const updated = await window.electron.invoke("browser:updateBookmark", {
                    id: current.bookmarkId,
                    title: values.title,
                    category,
                });
                if (updated) {
                    setBookmarks((previous) =>
                        previous.map((bookmark) => (bookmark.id === updated.id ? updated : bookmark)),
                    );
                }
            }
            saveLastBookmarkCategory(category);
            setBookmarkBubble(null);
            setSnapshot("");
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : "Could not save this bookmark");
        }
    };

    const removeBookmarkById = async (id: string) => {
        try {
            const removed = await window.electron.invoke("browser:removeBookmark", { id });
            if (removed) {
                setBookmarks((previous) => previous.filter((bookmark) => bookmark.id !== id));
            }
            setBookmarkBubble((previous) => (previous?.bookmarkId === id ? null : previous));
            setSnapshot("");
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

    const closeMenu = () => {
        setMenu(null);
    };

    const closeDownloads = () => {
        setDownloadsOpen(false);
        const seenAt = Date.now();
        try {
            window.localStorage.setItem(DOWNLOADS_SEEN_KEY, String(seenAt));
        } catch {
            // The badge is cosmetic; storage can be unavailable in hardened profiles.
        }
        setDownloadsSeenAt(seenAt);
    };

    const toggleDownloads = async () => {
        if (downloadsOpen) {
            closeDownloads();
            return;
        }
        // Freeze the page before hiding the native view so the bubble never flashes the fallback.
        await capturePageSnapshot(1200);
        setMenu(null);
        setScanOpen(false);
        setExtensionsOpen(false);
        setBookmarkBubble(null);
        const seenAt = Date.now();
        try {
            window.localStorage.setItem(DOWNLOADS_SEEN_KEY, String(seenAt));
        } catch {
            // The badge is cosmetic; storage can be unavailable in hardened profiles.
        }
        setDownloadsSeenAt(seenAt);
        setDownloadsOpen(true);
    };

    const openFullDownloadHistory = () => {
        setDownloadsOpen(false);
        openDownloadHistory();
    };

    const contextAction = async (action: "open" | "new-tab" | "copy" | "download" | "external") => {
        if (!menu) return;
        const url = menu.linkURL || menu.pageURL;
        if (action === "open" && menu.linkURL) {
            await window.electron.invoke("browser:navigate", { id: menu.tabId, input: menu.linkURL });
        } else if (action === "new-tab" && menu.linkURL) {
            await window.electron.invoke("browser:createTab", { url: menu.linkURL, activate: false });
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
        if (definition.id === "adblock") {
            return {
                ...definition,
                pinned,
                active: adblockEnabled,
                disabled: false,
                status: adblockEnabled ? "On" : "Off",
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
                    setExtensionsOpen(false);
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

    const pinnedRightTools = pinnedTools;

    const renderToolTile = (id: BrowserToolId) => {
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
                    title="Send current page to Downloader"
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
                    <button
                        type="button"
                        className="browserIconBtn browserCloseBrowserBtn"
                        title="Close browser"
                        onClick={close}
                    >
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
                        placeholder={`Search ${ENGINE_LABEL[engine]} or enter URL`}
                        spellCheck={false}
                    />
                    {pinnedRightTools.length > 0 ? <div className="browserToolbarDivider" aria-hidden /> : null}
                    {pinnedRightTools.map((id) => (
                        <Fragment key={id}>{renderToolTile(id)}</Fragment>
                    ))}
                    <div className="browserToolbarDivider" aria-hidden />
                    <button
                        ref={downloadsButtonRef}
                        type="button"
                        className={`browserToolTile browserDownloadsBtn${activeDownloadRows.length > 0 ? " is-active" : ""}${hasUnseenDownloads ? " has-unseen" : ""}${downloadsOpen ? " is-open" : ""}`}
                        title={
                            activeDownloadRows.length > 0
                                ? `${activeDownloadRows.length} download${activeDownloadRows.length === 1 ? "" : "s"} in progress`
                                : "Downloads"
                        }
                        aria-label="Downloads"
                        aria-haspopup="dialog"
                        aria-expanded={downloadsOpen}
                        onClick={() => void toggleDownloads()}
                    >
                        <FontAwesomeIcon icon={faDownload} />
                        {activeDownloadRows.length > 0 ? (
                            <span
                                className={`browserDownloadRing${downloadRingPercent === null ? " is-indeterminate" : ""}`}
                                style={
                                    downloadRingPercent === null
                                        ? undefined
                                        : ({
                                              "--download-progress": `${downloadRingPercent}%`,
                                          } as CSSProperties)
                                }
                                aria-hidden
                            />
                        ) : null}
                        {hasUnseenDownloads ? <span className="browserDownloadDot" aria-hidden /> : null}
                    </button>
                    <button
                        type="button"
                        className={`browserToolTile browserExtensionsBtn ${extensionsOpen ? "is-open" : ""}`}
                        title="Extensions"
                        aria-label="Extensions"
                        aria-haspopup="dialog"
                        aria-expanded={extensionsOpen}
                        onClick={() => void toggleExtensions()}
                    >
                        <FontAwesomeIcon icon={faPuzzlePiece} />
                    </button>
                    {extensionsOpen ? (
                        <BrowserExtensionsMenu
                            engine={engine}
                            onEngineChange={changeEngine}
                            tools={toolEntries}
                            onTogglePin={togglePinnedTool}
                            onOpenSettings={(target) => {
                                close();
                                dispatch(requestSettingsNav(target));
                            }}
                            onClose={closeExtensions}
                        />
                    ) : null}
                    {bookmarkBubble ? (
                        <BrowserBookmarkBubble
                            draft={bookmarkBubble}
                            categories={bookmarkCategoryOptions}
                            onSave={(values) => void saveBookmarkDraft(values)}
                            onRemove={() => {
                                if (bookmarkBubble.bookmarkId) {
                                    void removeBookmarkById(bookmarkBubble.bookmarkId);
                                }
                            }}
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
                    ) : snapshot ? (
                        <img className="browserSnapshot" src={snapshot} alt="" draggable={false} />
                    ) : overlayOpen ? (
                        <div className="browserSnapshotBlank" aria-hidden />
                    ) : (
                        <div className="browserContentFallback">
                            <FontAwesomeIcon icon={faGlobe} />
                            <span>{state.loading ? "Loading…" : "Browser"}</span>
                        </div>
                    )}
                </div>

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
                                    Open selected in Downloader
                                </button>
                                <button type="button" className="browserScanAction" onClick={closeScan}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

                {menu ? (
                    <>
                        <div
                            className="browserContextMenuBackdrop"
                            onMouseDown={closeMenu}
                            onContextMenu={(event) => {
                                event.preventDefault();
                                closeMenu();
                            }}
                        />
                        <div className="browserContextMenu" style={{ left: menu.menuX, top: menu.menuY }}>
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
                                        Send link to Downloader
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
                                        Send page to Downloader
                                    </button>
                                    {darkAvailable ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                toggleDarkForSite();
                                                closeMenu();
                                            }}
                                        >
                                            {currentDisabled
                                                ? "Enable dark for this site"
                                                : "Disable dark for this site"}
                                        </button>
                                    ) : null}
                                    <button type="button" onClick={() => void contextAction("copy")}>
                                        Copy page URL
                                    </button>
                                </>
                            )}
                            <button type="button" onClick={() => void contextAction("external")}>
                                Open in default browser
                            </button>
                        </div>
                    </>
                ) : null}

                {downloadsOpen
                    ? (createPortal(
                          <>
                              <div
                                  className="browserDownloadsBackdrop"
                                  onMouseDown={closeDownloads}
                                  onContextMenu={(event) => {
                                      event.preventDefault();
                                      closeDownloads();
                                  }}
                              />
                              <div
                                  className="browserDownloadsBubble"
                                  style={{ top: downloadsPos?.top ?? 64, right: downloadsPos?.right ?? 16 }}
                                  role="dialog"
                                  aria-label="Recent download history"
                              >
                                  <div className="browserDownloadsHead">
                                      <strong>Recent download history</strong>
                                      <button
                                          type="button"
                                          className="browserDownloadsClose"
                                          title="Close"
                                          aria-label="Close downloads"
                                          onClick={closeDownloads}
                                      >
                                          <FontAwesomeIcon icon={faXmark} />
                                      </button>
                                  </div>
                                  <div className="browserDownloadsList">
                                      {downloadRows.length === 0 ? (
                                          <p className="browserDownloadsEmpty">No recent downloads</p>
                                      ) : (
                                          downloadRows.map((row) => {
                                              const kind = downloadFileKind(row.path || row.title);
                                              const percent = downloadProgressPercent(row);
                                              return (
                                                  <div
                                                      className={`browserDownloadRow is-${row.status}`}
                                                      key={row.key}
                                                  >
                                                      <span
                                                          className={`browserDownloadType is-${kind}`}
                                                          aria-hidden
                                                      >
                                                          <FontAwesomeIcon icon={DOWNLOAD_KIND_ICON[kind]} />
                                                      </span>
                                                      <div className="browserDownloadText">
                                                          <span className="browserDownloadName" title={row.title}>
                                                              {row.title}
                                                          </span>
                                                          <span className="browserDownloadMeta">
                                                              {formatDownloadMeta(row, downloadsNowTick)}
                                                          </span>
                                                          {row.status === "progressing" ? (
                                                              <span
                                                                  className={`browserDownloadBar${percent === null ? " is-indeterminate" : ""}`}
                                                                  aria-hidden
                                                              >
                                                                  <span
                                                                      style={{
                                                                          width: `${percent ?? 35}%`,
                                                                      }}
                                                                  />
                                                              </span>
                                                          ) : null}
                                                      </div>
                                                      <span className="browserDownloadActions">
                                                          {row.status === "progressing" &&
                                                          row.source === "browser" ? (
                                                              <button
                                                                  type="button"
                                                                  title="Cancel download"
                                                                  aria-label={`Cancel ${row.title}`}
                                                                  onClick={() =>
                                                                      void window.electron.invoke(
                                                                          "browser:cancelDownload",
                                                                          { id: row.id },
                                                                      )
                                                                  }
                                                              >
                                                                  <FontAwesomeIcon icon={faXmark} />
                                                              </button>
                                                          ) : null}
                                                          {row.path ? (
                                                              <button
                                                                  type="button"
                                                                  title="Show in folder"
                                                                  aria-label={`Show ${row.title} in folder`}
                                                                  onClick={() =>
                                                                      window.electron.showItemInFolder(row.path)
                                                                  }
                                                              >
                                                                  <FontAwesomeIcon icon={faFolderOpen} />
                                                              </button>
                                                          ) : null}
                                                      </span>
                                                  </div>
                                              );
                                          })
                                      )}
                                  </div>
                                  <button
                                      type="button"
                                      className="browserDownloadsFull"
                                      onClick={openFullDownloadHistory}
                                  >
                                      <span>Full download history</span>
                                      <FontAwesomeIcon icon={faUpRightFromSquare} />
                                  </button>
                              </div>
                          </>,
                          document.body,
                      ) as unknown as ReactElement)
                    : null}
            </div>
        </div>
    );
};

export default BrowserHost;
