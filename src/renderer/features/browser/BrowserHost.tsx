import type {
    BrowserContextMenuRequest,
    BrowserDownload,
    BrowserSearchEngine,
    BrowserState,
} from "@common/types/browser";
import {
    faArrowLeft,
    faArrowRight,
    faDownload,
    faGlobe,
    faMoon,
    faPlus,
    faRotate,
    faSun,
    faUpRightFromSquare,
    faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppContext } from "@renderer/App";
import { useAppSelector } from "@store/hooks";
import { selectModalOverlayOpen } from "@store/ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrowserMode, OpenBrowserDetail } from "./browserEvents";
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

/**
 * React shell for the native WebContentsView browser. The native view sits over
 * `.browserContent`; tabs/toolbar/menus stay in the renderer.
 */
const BrowserHost = () => {
    const { openDownloader, downloaderOpen, videoOpen } = useAppContext();
    const folders = useAppSelector((store) => store.mainSettings.library.folders);
    const defaultOutDir = useAppSelector((store) => {
        const folder = store.mainSettings.library.folders.find((row) => row.isDefaultLocation);
        return folder?.path ?? "";
    });
    const modalOverlayOpen = useAppSelector(selectModalOverlayOpen);
    const readerActive = useAppSelector((store) => store.reader.active);

    const [mode, setMode] = useState<BrowserMode | null>(null);
    const [state, setState] = useState<BrowserState>(EMPTY_STATE);
    const [address, setAddress] = useState("");
    const [engine, setEngine] = useState<BrowserSearchEngine>(readSavedEngine);
    const [sideWidth, setSideWidth] = useState(460);
    const [disabledHosts, setDisabledHosts] = useState<string[]>(readSavedDisabledHosts);
    const [menu, setMenu] = useState<ContextMenuState | null>(null);
    const [downloads, setDownloads] = useState<BrowserDownload[]>([]);
    const [error, setError] = useState("");
    const paneRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastBounds = useRef("");
    const addressFocused = useRef(false);

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
        const onOpen = (event: Event) => {
            const detail = (event as CustomEvent<OpenBrowserDetail>).detail;
            if (!detail?.mode) return;
            setMode(detail.mode);
            setMenu(null);
            const saved = readSavedEngine();
            setEngine(saved);
            void window.electron.invoke("browser:setSearchEngine", { engine: saved });
            for (const host of readSavedDisabledHosts()) {
                void window.electron.invoke("browser:setHostForceDark", {
                    hostOrUrl: host,
                    enabled: false,
                });
            }
            void ensureTab();
        };
        window.addEventListener("yokomura:open-browser", onOpen);
        return () => window.removeEventListener("yokomura:open-browser", onOpen);
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
        const next = state.url || "";
        if (!addressFocused.current) setAddress(next);
    }, [state.url, state.activeId, mode]);

    useEffect(() => {
        if (mode) return;
        lastBounds.current = "";
        void window.electron.invoke("browser:setVisible", { visible: false });
    }, [mode]);

    const visible = Boolean(mode) && !modalOverlayOpen && !readerActive && !menu && !downloaderOpen && !videoOpen;

    useEffect(() => {
        void window.electron.invoke("browser:setVisible", { visible });
        if (visible) {
            lastBounds.current = "";
            requestAnimationFrame(syncBounds);
        }
    }, [visible, syncBounds]);

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
        if (readerActive && mode) setMode(null);
    }, [readerActive, mode]);

    const activeTab = state.tabs.find((tab) => tab.id === state.activeId);
    const currentDisabled = activeTab ? disabledHosts.includes(hostOf(activeTab.url)) : false;

    const close = () => {
        setMode(null);
        setMenu(null);
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

    const addToDownloader = async (url: string) => {
        if (!url) return;
        const outDir = defaultOutDir || folders[0]?.path || window.electron.app.getPath("downloads");
        await window.electron.invoke("downloader:add", { url, outDir, keepFolder: false });
        openDownloader();
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
                                title={tab.title || tab.url}
                            >
                                {tab.favicon ? (
                                    <img src={tab.favicon} alt="" draggable={false} />
                                ) : (
                                    <FontAwesomeIcon icon={faGlobe} />
                                )}
                                <span>{tab.title || tab.url || "New Tab"}</span>
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
                        onChange={(event) => {
                            const next = event.currentTarget.value as BrowserSearchEngine;
                            setEngine(next);
                            window.localStorage.setItem("yokomura-browser-engine", next);
                            void window.electron.invoke("browser:setSearchEngine", { engine: next });
                        }}
                        title="Search engine"
                    >
                        <option value="brave">Brave</option>
                        <option value="google">Google</option>
                        <option value="duckduckgo">DuckDuckGo</option>
                    </select>
                    <button
                        type="button"
                        className={`browserIconBtn ${currentDisabled ? "" : "is-on"}`}
                        title={currentDisabled ? "Enable dark for this site" : "Disable dark for this site"}
                        onClick={() => {
                            if (!activeTab) return;
                            const host = hostOf(activeTab.url);
                            if (!host) return;
                            const nextHosts = currentDisabled
                                ? disabledHosts.filter((row) => row !== host)
                                : [...disabledHosts, host];
                            setDisabledHosts(nextHosts);
                            window.localStorage.setItem(
                                "yokomura-browser-disabled-hosts",
                                JSON.stringify(nextHosts),
                            );
                            void window.electron.invoke("browser:setHostForceDark", {
                                hostOrUrl: host,
                                enabled: currentDisabled,
                            });
                        }}
                    >
                        <FontAwesomeIcon icon={currentDisabled ? faSun : faMoon} />
                    </button>
                    <button
                        type="button"
                        className="browserIconBtn"
                        title="Add current page to Downloader"
                        onClick={() => void addToDownloader(state.url)}
                    >
                        <FontAwesomeIcon icon={faDownload} />
                    </button>
                    <button
                        type="button"
                        className="browserIconBtn"
                        title="Open in default browser"
                        onClick={() => state.url && void window.electron.openExternal(state.url)}
                    >
                        <FontAwesomeIcon icon={faUpRightFromSquare} />
                    </button>
                </div>

                {error ? <div className="browserError">{error}</div> : null}
                <div className="browserContent" ref={contentRef}>
                    <div className="browserContentFallback">
                        <FontAwesomeIcon icon={faGlobe} />
                        <span>{state.loading ? "Loading…" : "Browser"}</span>
                    </div>
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
