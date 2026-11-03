import { openBrowser } from "@features/browser/browserEvents";
import { SETTINGS_TABS } from "@features/settings/utils/constants";
import { navigateToSetting } from "@features/settings/utils/navigateToSetting";
import {
    buildSettingsTargetSearchTexts,
    filterSettingsTargets,
    getAllSettingsTargets,
    isSettingsTargetAvailable,
    type SettingsTarget,
} from "@features/settings/utils/settingsTargets";
import {
    faBook,
    faBookmark,
    faBookOpen,
    faCog,
    faCompass,
    faDownload,
    faFilm,
    faGlobe,
    faGrip,
    faList,
    faMagnifyingGlass,
    faTimes,
    faTrash,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppContext } from "@renderer/App";
import { setAppSettings } from "@store/appSettings";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { toggleSettingsOpen } from "@store/ui";
import { resolveMangaChapterPath } from "@utils/mangaChapterPath";
import {
    type ReactElement,
    type KeyboardEvent as ReactKeyboardEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { useTranslation } from "react-i18next";
import "./quickJump.scss";

type FilterTab = "all" | "library" | "bookmarks" | "settings";

type QuickJumpItem = {
    id: string;
    group: "urls" | "library" | "bookmarks" | "settings" | "actions";
    title: string;
    subtitle: string;
    badge: string;
    badgeClass: string;
    icon: typeof faBook;
    action: () => void;
};

const isUrlLike = (text: string): boolean => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (/^https?:\/\//i.test(trimmed)) return true;
    if (/^www\.[a-z0-9-]+\.[a-z]+/i.test(trimmed)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(trimmed) && trimmed.includes(".");
};

const normalizeUrl = (text: string): string => {
    const trimmed = text.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    return `https://${trimmed}`;
};

export const QuickJump = (): ReactElement | null => {
    const { i18n } = useTranslation("common");
    const { t: tSettings } = useTranslation("settings");
    const { t: tReader } = useTranslation("reader");
    const { t: tUsage } = useTranslation("usage");

    const dispatch = useAppDispatch();
    const { openInReader, openDownloader, openMedia, openTrash } = useAppContext();

    const libraryItems = useAppSelector((state) => state.library.items);
    const mangaBookmarks = useAppSelector((state) => state.bookmarks.manga);
    const bookBookmarks = useAppSelector((state) => state.bookmarks.book);
    const viewMode = useAppSelector((state) => state.appSettings.homeViewMode);

    const [isOpen, setIsOpen] = useState(false);
    const isOpenRef = useRef(isOpen);
    isOpenRef.current = isOpen;
    const [query, setQuery] = useState("");
    const [selectedTab, setSelectedTab] = useState<FilterTab>("all");
    const [selectedIndex, setSelectedIndex] = useState(0);

    const inputRef = useRef<HTMLInputElement>(null);
    const resultsRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen((prev) => !prev);
                return;
            }
            if (e.key === "Escape" && isOpenRef.current) {
                e.preventDefault();
                e.stopPropagation();
                setIsOpen(false);
            }
        };

        const handleToggleEvent = () => {
            setIsOpen((prev) => !prev);
        };

        window.addEventListener("keydown", handleGlobalKeyDown, true);
        window.addEventListener("yokomura:toggle-quickjump", handleToggleEvent);
        return () => {
            window.removeEventListener("keydown", handleGlobalKeyDown, true);
            window.removeEventListener("yokomura:toggle-quickjump", handleToggleEvent);
        };
    }, []);

    useEffect(() => {
        if (isOpen) {
            setQuery("");
            setSelectedTab("all");
            setSelectedIndex(0);
            window.setTimeout(() => {
                inputRef.current?.focus();
            }, 30);
        }
    }, [isOpen]);

    const resolveSettingLabel = useCallback(
        (target: SettingsTarget): string => {
            if (target.labelNs === "reader") return tReader(target.labelKey);
            if (target.labelNs === "usage") return tUsage(target.labelKey);
            return tSettings(target.labelKey);
        },
        [tReader, tUsage, tSettings],
    );

    const resolveSettingGroupLabel = useCallback(
        (target: SettingsTarget): string => {
            if (!target.groupLabelKey) {
                const tab = SETTINGS_TABS.find((entry) => entry.key === target.tab);
                return tab ? tSettings(tab.labelKey) : target.tab;
            }
            if (target.labelNs === "reader") return tReader(target.groupLabelKey);
            if (target.labelNs === "usage") return tUsage(target.groupLabelKey);
            return tSettings(target.groupLabelKey);
        },
        [tSettings, tReader, tUsage],
    );

    const close = useCallback(() => {
        setIsOpen(false);
    }, []);

    const rawResults = useMemo((): QuickJumpItem[] => {
        const q = query.trim().toLowerCase();
        const items: QuickJumpItem[] = [];

        if (isUrlLike(query)) {
            const url = normalizeUrl(query);
            items.push(
                {
                    id: "url-browser",
                    group: "urls",
                    title: "Open in Web Browser",
                    subtitle: url,
                    badge: "Browser",
                    badgeClass: "badge-url",
                    icon: faGlobe,
                    action: () => {
                        openBrowser({ url, mode: "full" });
                        close();
                    },
                },
                {
                    id: "url-downloader",
                    group: "urls",
                    title: "Download with Downloader",
                    subtitle: url,
                    badge: "Downloader",
                    badgeClass: "badge-url",
                    icon: faDownload,
                    action: () => {
                        openDownloader(url);
                        close();
                    },
                },
            );
        }

        const validLibraryRows = Object.values(libraryItems).filter(
            (row): row is NonNullable<typeof row> => row !== null,
        );

        const libraryMatches = validLibraryRows
            .filter((row) => {
                if (!q) return true;
                return (
                    row.title.toLowerCase().includes(q) ||
                    (row.author?.toLowerCase().includes(q) ?? false) ||
                    row.link.toLowerCase().includes(q)
                );
            })
            .slice(0, q ? 20 : 6)
            .map((row) => {
                const isManga = row.type === "manga";
                const progressInfo = row.progress
                    ? "chapterName" in row.progress && row.progress.chapterName
                        ? `Ch. ${row.progress.chapterName}`
                        : "chapterId" in row.progress && row.progress.chapterName
                          ? `Ch. ${row.progress.chapterName}`
                          : ""
                    : "";
                const subtitleParts = [isManga ? "Manga" : "Book"];
                if (progressInfo) subtitleParts.push(progressInfo);
                if (row.author) subtitleParts.push(row.author);

                return {
                    id: `lib-${row.link}`,
                    group: "library" as const,
                    title: row.title,
                    subtitle: subtitleParts.join(" • "),
                    badge: isManga ? "Manga" : "Book",
                    badgeClass: isManga ? "badge-manga" : "badge-book",
                    icon: isManga ? faBookOpen : faBook,
                    action: () => {
                        if (isManga && row.progress && "chapterName" in row.progress && row.progress.chapterName) {
                            const path = resolveMangaChapterPath(row.link, row.progress.chapterName);
                            openInReader(path, { mangaPageNumber: row.progress.currentPage || 1 });
                        } else if (
                            !isManga &&
                            row.progress &&
                            "chapterId" in row.progress &&
                            row.progress.chapterId
                        ) {
                            openInReader(row.link, {
                                epubChapterId: row.progress.chapterId,
                                epubElementQueryString: row.progress.position,
                            });
                        } else {
                            openInReader(row.link);
                        }
                        close();
                    },
                };
            });
        items.push(...libraryMatches);

        const allMangaBookmarks = Object.entries(mangaBookmarks).flatMap(([link, list]) =>
            (list || []).map((bm) => ({ bm, link })),
        );
        const allBookBookmarks = Object.entries(bookBookmarks).flatMap(([link, list]) =>
            (list || []).map((bm) => ({ bm, link })),
        );

        const bookmarkMatches: QuickJumpItem[] = [];
        for (const { bm, link } of allMangaBookmarks) {
            const parent = libraryItems[link];
            const title = parent?.title || bm.chapterName;
            const matchesQuery =
                !q ||
                title.toLowerCase().includes(q) ||
                bm.chapterName.toLowerCase().includes(q) ||
                Boolean(bm.note?.toLowerCase().includes(q));

            if (matchesQuery) {
                const subParts = [`Ch. ${bm.chapterName}`, `Page ${bm.page}`];
                if (bm.note) subParts.push(`"${bm.note}"`);
                bookmarkMatches.push({
                    id: `bm-manga-${bm.id}`,
                    group: "bookmarks",
                    title,
                    subtitle: subParts.join(" • "),
                    badge: "Bookmark",
                    badgeClass: "badge-bookmark",
                    icon: faBookmark,
                    action: () => {
                        const path = resolveMangaChapterPath(bm.itemLink, bm.chapterName);
                        openInReader(path, { mangaPageNumber: bm.page });
                        close();
                    },
                });
            }
            if (bookmarkMatches.length >= (q ? 15 : 4)) break;
        }

        for (const { bm, link } of allBookBookmarks) {
            if (bookmarkMatches.length >= (q ? 20 : 6)) break;
            const parent = libraryItems[link];
            const title = parent?.title || bm.chapterName;
            const matchesQuery =
                !q ||
                title.toLowerCase().includes(q) ||
                bm.chapterName.toLowerCase().includes(q) ||
                Boolean(bm.note?.toLowerCase().includes(q));

            if (matchesQuery) {
                const subParts = [`Ch. ${bm.chapterName}`];
                if (bm.note) subParts.push(`"${bm.note}"`);
                bookmarkMatches.push({
                    id: `bm-book-${bm.id}`,
                    group: "bookmarks",
                    title,
                    subtitle: subParts.join(" • "),
                    badge: "Bookmark",
                    badgeClass: "badge-bookmark",
                    icon: faBookmark,
                    action: () => {
                        openInReader(bm.itemLink, {
                            epubChapterId: bm.chapterId,
                            epubElementQueryString: bm.position,
                        });
                        close();
                    },
                });
            }
        }
        items.push(...bookmarkMatches);

        if (q) {
            const availableTargets = getAllSettingsTargets().filter((t) => isSettingsTargetAvailable(t));
            const getSearchTexts = (target: SettingsTarget) =>
                buildSettingsTargetSearchTexts(target, resolveSettingLabel, (ns, path) =>
                    i18n.t(path, { ns, returnObjects: true }),
                );
            const matchedTargets = filterSettingsTargets(availableTargets, q, getSearchTexts).slice(0, 15);

            for (const target of matchedTargets) {
                items.push({
                    id: `setting-${target.id}`,
                    group: "settings",
                    title: resolveSettingLabel(target),
                    subtitle: `Settings • ${resolveSettingGroupLabel(target)}`,
                    badge: "Settings",
                    badgeClass: "badge-settings",
                    icon: faCog,
                    action: () => {
                        navigateToSetting(target.id, dispatch);
                        close();
                    },
                });
            }
        }

        const actionCandidates: QuickJumpItem[] = [
            {
                id: "action-settings",
                group: "actions",
                title: "Open Settings",
                subtitle: "App preferences & appearance",
                badge: "Action",
                badgeClass: "badge-action",
                icon: faCog,
                action: () => {
                    dispatch(toggleSettingsOpen());
                    close();
                },
            },
            {
                id: "action-browser",
                group: "actions",
                title: "Open Web Browser",
                subtitle: "Browse sites and reader tools",
                badge: "Action",
                badgeClass: "badge-action",
                icon: faGlobe,
                action: () => {
                    openBrowser({ mode: "full" });
                    close();
                },
            },
            {
                id: "action-downloader",
                group: "actions",
                title: "Open Downloader",
                subtitle: "Batch download manga & sites",
                badge: "Action",
                badgeClass: "badge-action",
                icon: faDownload,
                action: () => {
                    openDownloader();
                    close();
                },
            },
            {
                id: "action-media",
                group: "actions",
                title: "Open Media Player",
                subtitle: "Video playback & media library",
                badge: "Action",
                badgeClass: "badge-action",
                icon: faFilm,
                action: () => {
                    openMedia();
                    close();
                },
            },
            {
                id: "action-trash",
                group: "actions",
                title: "Open Trash",
                subtitle: "Recently deleted files",
                badge: "Action",
                badgeClass: "badge-action",
                icon: faTrash,
                action: () => {
                    openTrash();
                    close();
                },
            },
            {
                id: "action-viewmode",
                group: "actions",
                title: viewMode === "gallery" ? "Switch to Classic View" : "Switch to Gallery View",
                subtitle: `Current view: ${viewMode}`,
                badge: "Action",
                badgeClass: "badge-action",
                icon: viewMode === "gallery" ? faList : faGrip,
                action: () => {
                    dispatch(setAppSettings({ homeViewMode: viewMode === "gallery" ? "classic" : "gallery" }));
                    close();
                },
            },
        ];

        if (!q) {
            items.push(...actionCandidates);
        } else {
            const filteredActions = actionCandidates.filter(
                (act) => act.title.toLowerCase().includes(q) || act.subtitle.toLowerCase().includes(q),
            );
            items.push(...filteredActions);
        }

        return items;
    }, [
        query,
        libraryItems,
        mangaBookmarks,
        bookBookmarks,
        viewMode,
        resolveSettingLabel,
        resolveSettingGroupLabel,
        i18n,
        openInReader,
        openDownloader,
        openMedia,
        openTrash,
        dispatch,
        close,
    ]);

    const filteredResults = useMemo(() => {
        if (selectedTab === "all") return rawResults;
        if (selectedTab === "library") return rawResults.filter((r) => r.group === "library");
        if (selectedTab === "bookmarks") return rawResults.filter((r) => r.group === "bookmarks");
        if (selectedTab === "settings") return rawResults.filter((r) => r.group === "settings");
        return rawResults;
    }, [rawResults, selectedTab]);

    const selectTab = (tab: FilterTab) => {
        setSelectedTab(tab);
        setSelectedIndex(0);
    };

    useEffect(() => {
        if (itemRefs.current[selectedIndex]) {
            itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
        }
    }, [selectedIndex]);

    const handleKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) => (filteredResults.length ? (prev + 1) % filteredResults.length : 0));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) =>
                filteredResults.length ? (prev - 1 + filteredResults.length) % filteredResults.length : 0,
            );
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (filteredResults[selectedIndex]) {
                filteredResults[selectedIndex].action();
            }
        } else if (e.key === "Escape") {
            e.preventDefault();
            close();
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="quickJumpOverlay"
            onClick={close}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    close();
                }
            }}
            role="dialog"
            aria-modal="true"
        >
            <div className="quickJumpModal" onClick={(e) => e.stopPropagation()}>
                <div className="quickJumpHeader">
                    <FontAwesomeIcon icon={faMagnifyingGlass} className="quickJumpSearchIcon" />
                    <input
                        ref={inputRef}
                        type="text"
                        className="quickJumpInput"
                        placeholder="Search library, bookmarks, settings, or paste URL..."
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setSelectedIndex(0);
                        }}
                        onKeyDown={handleKeyDown}
                    />
                    <div className="quickJumpHeaderActions">
                        {query && (
                            <button
                                type="button"
                                className="quickJumpClearBtn"
                                onClick={() => {
                                    setQuery("");
                                    setSelectedIndex(0);
                                }}
                                title="Clear"
                            >
                                <FontAwesomeIcon icon={faTimes} />
                            </button>
                        )}
                        <span className="quickJumpBadge">ESC</span>
                    </div>
                </div>

                <div className="quickJumpTabs">
                    <button
                        type="button"
                        className={`quickJumpTab ${selectedTab === "all" ? "active" : ""}`}
                        onClick={() => selectTab("all")}
                    >
                        All
                    </button>
                    <button
                        type="button"
                        className={`quickJumpTab ${selectedTab === "library" ? "active" : ""}`}
                        onClick={() => selectTab("library")}
                    >
                        Library
                    </button>
                    <button
                        type="button"
                        className={`quickJumpTab ${selectedTab === "bookmarks" ? "active" : ""}`}
                        onClick={() => selectTab("bookmarks")}
                    >
                        Bookmarks
                    </button>
                    <button
                        type="button"
                        className={`quickJumpTab ${selectedTab === "settings" ? "active" : ""}`}
                        onClick={() => selectTab("settings")}
                    >
                        Settings
                    </button>
                </div>

                <div className="quickJumpResults" ref={resultsRef}>
                    {filteredResults.length === 0 ? (
                        <div className="quickJumpEmpty">
                            <FontAwesomeIcon icon={faCompass} className="quickJumpEmptyIcon" />
                            <p>No results found for &ldquo;{query}&rdquo;</p>
                            <span className="quickJumpEmptySub">
                                Try searching for titles, chapters, settings, or paste a URL
                            </span>
                        </div>
                    ) : (
                        filteredResults.map((item, index) => {
                            const isSelected = index === selectedIndex;
                            return (
                                <button
                                    key={item.id}
                                    ref={(el) => {
                                        itemRefs.current[index] = el;
                                    }}
                                    type="button"
                                    className={`quickJumpItem ${isSelected ? "selected" : ""}`}
                                    onClick={item.action}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    <div className="quickJumpItemIconCont">
                                        <FontAwesomeIcon icon={item.icon} />
                                    </div>
                                    <div className="quickJumpItemBody">
                                        <div className="quickJumpItemTitle">{item.title}</div>
                                        <div className="quickJumpItemSubtitle">{item.subtitle}</div>
                                    </div>
                                    <span className={`quickJumpItemBadge ${item.badgeClass}`}>{item.badge}</span>
                                    <span className="quickJumpEnterHint">↵</span>
                                </button>
                            );
                        })
                    )}
                </div>

                <div className="quickJumpFooter">
                    <div className="quickJumpShortcuts">
                        <span>
                            <kbd>↑</kbd> <kbd>↓</kbd> Navigate
                        </span>
                        <span>
                            <kbd>↵</kbd> Select
                        </span>
                        <span>
                            <kbd>ESC</kbd> Close
                        </span>
                    </div>
                    <div className="quickJumpCount">
                        {filteredResults.length} {filteredResults.length === 1 ? "result" : "results"}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default QuickJump;
