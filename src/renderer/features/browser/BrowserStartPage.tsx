import type { BrowserBookmark, BrowserSearchEngine } from "@common/types/browser";
import { faBookmark as faBookmarkRegular } from "@fortawesome/free-regular-svg-icons";
import { faArrowRight, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useState } from "react";
import {
    BROWSER_START_SITES,
    type BrowserStartCategory,
    type BrowserStartSite,
    browserStartHosts,
} from "./startSites";
import "./browserStartPage.scss";

type BrowserStartPageProps = {
    engine: BrowserSearchEngine;
    bookmarks: BrowserBookmark[];
    onOpenUrl: (url: string, newTab: boolean) => void;
    onSearch: (input: string) => void;
    onRemoveBookmark: (id: string) => void;
};

type SiteIconProps = {
    site: BrowserStartSite;
    icon?: string;
};

const ENGINE_LABEL: Record<BrowserSearchEngine, string> = {
    brave: "Brave",
    google: "Google",
    duckduckgo: "DuckDuckGo",
};

const SiteIcon = ({ site, icon }: SiteIconProps) => {
    const [failedIcon, setFailedIcon] = useState<string | undefined>(undefined);
    const failed = Boolean(icon) && failedIcon === icon;

    return (
        <span className="browserStartIcon" aria-hidden>
            {icon && !failed ? (
                <img src={icon} alt="" draggable={false} onError={() => setFailedIcon(icon)} />
            ) : (
                <span className="browserStartIconLetter">{site.name.charAt(0).toUpperCase()}</span>
            )}
        </span>
    );
};

const bookmarkHost = (url: string): string => {
    try {
        return new URL(url).hostname;
    } catch {
        return url;
    }
};

const BookmarkRow = ({
    bookmark,
    onOpen,
    onRemove,
}: {
    bookmark: BrowserBookmark;
    onOpen: (url: string, newTab: boolean) => void;
    onRemove: (id: string) => void;
}) => {
    const [failedIcon, setFailedIcon] = useState<string | undefined>(undefined);
    const failed = Boolean(bookmark.favicon) && failedIcon === bookmark.favicon;

    return (
        <div className="browserStartBookmark" title={bookmark.url}>
            <button
                type="button"
                className="browserStartBookmarkMain"
                onClick={(event) => onOpen(bookmark.url, event.ctrlKey || event.metaKey || event.shiftKey)}
                onAuxClick={(event) => {
                    if (event.button === 1) onOpen(bookmark.url, true);
                }}
            >
                <span className="browserStartBookmarkIcon" aria-hidden>
                    {bookmark.favicon && !failed ? (
                        <img
                            src={bookmark.favicon}
                            alt=""
                            draggable={false}
                            onError={() => setFailedIcon(bookmark.favicon)}
                        />
                    ) : (
                        <FontAwesomeIcon icon={faBookmarkRegular} />
                    )}
                </span>
                <span className="browserStartBookmarkText">
                    <span className="browserStartBookmarkTitle">{bookmark.title}</span>
                    <span className="browserStartBookmarkDomain">{bookmarkHost(bookmark.url)}</span>
                </span>
            </button>
            <button
                type="button"
                className="browserStartBookmarkRemove"
                aria-label={`Remove bookmark ${bookmark.title}`}
                title="Remove bookmark"
                onClick={() => onRemove(bookmark.id)}
            >
                <FontAwesomeIcon icon={faXmark} />
            </button>
        </div>
    );
};

const SiteCard = ({
    site,
    icon,
    onOpen,
}: {
    site: BrowserStartSite;
    icon?: string;
    onOpen: (site: BrowserStartSite, newTab: boolean) => void;
}) => (
    <button
        type="button"
        className="browserStartCard"
        title={`${site.name} — ${site.url}${site.downloaderSupported ? " · Downloader supported" : ""}`}
        onClick={(event) => onOpen(site, event.ctrlKey || event.metaKey || event.shiftKey)}
        onAuxClick={(event) => {
            if (event.button === 1) onOpen(site, true);
        }}
    >
        <SiteIcon site={site} icon={icon} />
        <span className="browserStartCardText">
            <span className="browserStartCardTitle">{site.name}</span>
            <span className="browserStartCardDomain">{site.domain}</span>
        </span>
    </button>
);

/** Chrome-style New Tab page rendered inside the browser panel for `about:blank`. */
const BrowserStartPage = ({ engine, bookmarks, onOpenUrl, onSearch, onRemoveBookmark }: BrowserStartPageProps) => {
    const [query, setQuery] = useState("");
    const [icons, setIcons] = useState<Record<string, string>>({});
    const hosts = useMemo(() => browserStartHosts(), []);

    useEffect(() => {
        let cancelled = false;
        void window.electron
            .invoke("browser:getSiteIcons", { hosts })
            .then((next) => {
                if (!cancelled) setIcons(next);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [hosts]);

    const openSite = (site: BrowserStartSite, newTab: boolean) => {
        onOpenUrl(site.url, newTab);
    };

    const groups: { key: BrowserStartCategory; title: string; sites: BrowserStartSite[] }[] = [
        {
            key: "manga",
            title: "Manga & Doujin",
            sites: BROWSER_START_SITES.filter((site) => site.category === "manga"),
        },
        {
            key: "video",
            title: "Video",
            sites: BROWSER_START_SITES.filter((site) => site.category === "video"),
        },
    ];

    return (
        <div className="browserStart">
            <div className="browserStartInner">
                <header className="browserStartHeader">
                    <span className="browserStartEyebrow">New tab</span>
                    <h1>Where do you want to go?</h1>
                    <p>
                        Pick a site below, or search with {ENGINE_LABEL[engine]}. Ctrl/Cmd-click a site to open it
                        in a new tab.
                    </p>
                </header>

                <form
                    className="browserStartSearch"
                    onSubmit={(event) => {
                        event.preventDefault();
                        const value = query.trim();
                        if (value) onSearch(value);
                    }}
                >
                    <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.currentTarget.value)}
                        placeholder={`Search ${ENGINE_LABEL[engine]} or enter an address`}
                        aria-label="Search or enter an address"
                        spellCheck={false}
                        // biome-ignore lint/a11y/noAutofocus: a new tab should focus its search box
                        autoFocus
                    />
                    <button type="submit" aria-label="Search">
                        <FontAwesomeIcon icon={faArrowRight} />
                    </button>
                </form>

                {bookmarks.length > 0 ? (
                    <section
                        className="browserStartSection browserStartBookmarks"
                        aria-labelledby="browserStart-bookmarks"
                    >
                        <div className="browserStartSectionHead">
                            <h2 id="browserStart-bookmarks">Bookmarks</h2>
                            <span>{bookmarks.length} saved</span>
                        </div>
                        <div className="browserStartBookmarkGrid">
                            {bookmarks.map((bookmark) => (
                                <BookmarkRow
                                    key={bookmark.id}
                                    bookmark={bookmark}
                                    onOpen={onOpenUrl}
                                    onRemove={onRemoveBookmark}
                                />
                            ))}
                        </div>
                    </section>
                ) : null}

                {groups.map((group) => (
                    <section
                        className="browserStartSection"
                        key={group.key}
                        aria-labelledby={`browserStart-${group.key}`}
                    >
                        <div className="browserStartSectionHead">
                            <h2 id={`browserStart-${group.key}`}>{group.title}</h2>
                            <span>{group.sites.length} sites</span>
                        </div>
                        <div className="browserStartGrid">
                            {group.sites.map((site) => (
                                <SiteCard key={site.id} site={site} icon={icons[site.domain]} onOpen={openSite} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
};

export default BrowserStartPage;
