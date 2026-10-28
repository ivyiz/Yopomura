import type {
    BrowserContextMenuRequest,
    BrowserDownload,
    BrowserScannedLink,
    BrowserSearchEngine,
    BrowserState,
} from "@common/types/browser";
import {
    faArrowLeft,
    faArrowRight,
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
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import BrowserExtensionsMenu from "./BrowserExtensionsMenu";
import BrowserStartPage from "./BrowserStartPage";
import type { BrowserMode, ToggleBrowserDetail } from "./browserEvents";
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
    const [adblockEnabled, setAdblockEnabled] = useState<boolean>(readSavedAdblock);
    const modeRef = useRef<BrowserMode | null>(null);
    const paneRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastBounds = useRef("");
    const addressFocused = useRef(false);

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
        return () => {
            offState();
            offMenu();
            offDownload();
        };
    }, [contentBounds]);

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
    }, [readerActive, mode]);

    useEffect(() => {
        if (!mode) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
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
    }, [mode, scanOpen, extensionsOpen, syncBounds]);

    const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
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
                    <div className="browserToolbarDivider" aria-hidden />
                    <button
                        type="button"
                        className={`browserToolTile ${currentDisabled ? "" : "is-on"}`}
                        title={currentDisabled ? "Enable dark for this site" : "Disable dark for this site"}
                        aria-label="Toggle dark mode for this site"
                        aria-pressed={!currentDisabled}
                        onClick={toggleDarkForSite}
                    >
                        <FontAwesomeIcon icon={currentDisabled ? faSun : faMoon} />
                    </button>
                    <button
                        type="button"
                        className={`browserToolTile ${adblockEnabled ? "is-on" : ""}`}
                        title={
                            adblockEnabled
                                ? "Ad blocking on (click to disable)"
                                : "Ad blocking off (click to enable)"
                        }
                        aria-pressed={adblockEnabled}
                        onClick={toggleAdblock}
                    >
                        <FontAwesomeIcon icon={adblockEnabled ? faShield : faShieldHalved} />
                    </button>
                    <button
                        type="button"
                        className="browserToolTile"
                        title="Add current page to Downloader"
                        onClick={() => void addToDownloader(state.url)}
                    >
                        <FontAwesomeIcon icon={faDownload} />
                    </button>
                    <button
                        type="button"
                        className="browserToolTile is-secondary"
                        title="Scan links on this page"
                        disabled={!state.activeId}
                        onClick={() => void scanPageLinks()}
                    >
                        <FontAwesomeIcon icon={faLink} />
                    </button>
                    <button
                        type="button"
                        className="browserToolTile is-secondary"
                        title="Open in default browser"
                        onClick={() => state.url && void window.electron.openExternal(state.url)}
                    >
                        <FontAwesomeIcon icon={faUpRightFromSquare} />
                    </button>
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
                            setExtensionsOpen((previous) => !previous);
                        }}
                    >
                        <FontAwesomeIcon icon={faPuzzlePiece} />
                    </button>
                    {extensionsOpen ? (
                        <BrowserExtensionsMenu
                            engine={engine}
                            onEngineChange={changeEngine}
                            adblockEnabled={adblockEnabled}
                            onToggleAdblock={toggleAdblock}
                            darkEnabled={darkAvailable && !currentDisabled}
                            darkAvailable={darkAvailable}
                            onToggleDark={toggleDarkForSite}
                            canUsePage={canUsePage}
                            onScanLinks={() => {
                                setExtensionsOpen(false);
                                void scanPageLinks();
                            }}
                            onAddPage={() => {
                                setExtensionsOpen(false);
                                void addToDownloader(state.url);
                            }}
                            onClose={closeExtensions}
                        />
                    ) : null}
                </div>

                {error ? <div className="browserError">{error}</div> : null}
                <div className="browserContent" ref={contentRef}>
                    {newTabPage ? (
                        <BrowserStartPage engine={engine} onOpenUrl={openStartUrl} onSearch={searchFromStart} />
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
