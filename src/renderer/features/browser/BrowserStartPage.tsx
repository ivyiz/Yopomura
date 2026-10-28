import type { BrowserBookmark, BrowserSearchEngine } from "@common/types/browser";
import { faBookmark as faBookmarkRegular } from "@fortawesome/free-regular-svg-icons";
import { faArrowRight, faMagnifyingGlass, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useMemo, useState } from "react";
import { groupBookmarksByCategory } from "./browserBookmarks";
import "./browserStartPage.scss";

type BrowserStartPageProps = {
    engine: BrowserSearchEngine;
    bookmarks: BrowserBookmark[];
    onOpenUrl: (url: string, newTab: boolean) => void;
    onSearch: (input: string) => void;
    onRemoveBookmark: (id: string) => void;
};

const ENGINE_LABEL: Record<BrowserSearchEngine, string> = {
    brave: "Brave",
    google: "Google",
    duckduckgo: "DuckDuckGo",
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

/** New Tab page rendered inside the browser panel for `about:blank`. */
const BrowserStartPage = ({ engine, bookmarks, onOpenUrl, onSearch, onRemoveBookmark }: BrowserStartPageProps) => {
    const [query, setQuery] = useState("");
    const groups = useMemo(() => groupBookmarksByCategory(bookmarks), [bookmarks]);

    return (
        <div className="browserStart">
            <div className="browserStartInner">
                <header className="browserStartHeader">
                    <span className="browserStartEyebrow">New tab</span>
                    <h1>Where do you want to go?</h1>
                    <p>
                        Search with {ENGINE_LABEL[engine]}, or bookmark pages to build categories here.
                        Ctrl/Cmd-click a bookmark to open it in a new tab.
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

                {groups.length === 0 ? (
                    <div className="browserStartEmpty">
                        <FontAwesomeIcon icon={faBookmarkRegular} aria-hidden />
                        <h2>No bookmarks yet</h2>
                        <p>Open a page and press the bookmark button to create your first category.</p>
                    </div>
                ) : (
                    groups.map((group, index) => (
                        <section
                            className="browserStartSection browserStartCategory"
                            key={group.category}
                            aria-labelledby={`browserStart-category-${index}`}
                        >
                            <div className="browserStartSectionHead">
                                <h2 id={`browserStart-category-${index}`}>{group.category}</h2>
                                <span>
                                    {group.bookmarks.length} bookmark
                                    {group.bookmarks.length === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div className="browserStartBookmarkGrid">
                                {group.bookmarks.map((bookmark) => (
                                    <BookmarkRow
                                        key={bookmark.id}
                                        bookmark={bookmark}
                                        onOpen={onOpenUrl}
                                        onRemove={onRemoveBookmark}
                                    />
                                ))}
                            </div>
                        </section>
                    ))
                )}
            </div>
        </div>
    );
};

export default BrowserStartPage;
