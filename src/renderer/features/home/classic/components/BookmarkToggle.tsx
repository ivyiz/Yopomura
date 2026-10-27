import type { BookBookmark, MangaBookmark } from "@common/types/db";
import BookmarkHistoryListItem from "@features/home/classic/components/BookmarkHistoryListItem";
import { faBookmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Popover from "@renderer/components/ui/Popover";
import { useAppSelector } from "@store/hooks";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

type BookmarkRow = (BookBookmark | MangaBookmark) & { itemLink: string };

/**
 * Top-bar bookmarks toggle. Replaces the classic Bookmarks panel with a
 * popover list that scrolls independently from the home lists.
 */
const BookmarkToggle = () => {
    const { t } = useTranslation("common");
    const { t: tHome } = useTranslation("home");
    const bookmarks = useAppSelector((store) => store.bookmarks);
    const [open, setOpen] = useState(false);

    const rows = useMemo(() => {
        const all: BookmarkRow[] = [];
        for (const [itemLink, list] of Object.entries(bookmarks.book)) {
            for (const bookmark of list ?? []) all.push({ ...bookmark, itemLink });
        }
        for (const [itemLink, list] of Object.entries(bookmarks.manga)) {
            for (const bookmark of list ?? []) all.push({ ...bookmark, itemLink });
        }
        return all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }, [bookmarks]);

    const count = rows.length;

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || !e.shiftKey || e.key.toLowerCase() !== "b") return;
            const target = e.target as HTMLElement | null;
            if (
                target &&
                (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
            ) {
                return;
            }
            e.preventDefault();
            setOpen((value) => !value);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, []);

    return (
        <Popover
            className="bookmarkPopover"
            placement="bottom"
            align="start"
            offset={8}
            label={t("topBar.bookmarks")}
            open={open}
            onOpenChange={setOpen}
            trigger={
                <button
                    type="button"
                    className="bookmarkToggle"
                    tabIndex={-1}
                    onFocus={(e) => e.currentTarget.blur()}
                    data-tooltip={t("topBar.bookmarksTooltip")}
                >
                    <FontAwesomeIcon icon={faBookmark} />
                    {count > 0 && <span className="bookmarkToggleCount">{count > 99 ? "99+" : count}</span>}
                </button>
            }
        >
            {({ close }) => (
                <div
                    className="bookmarkPopoverBody"
                    onClickCapture={(e) => {
                        if ((e.target as HTMLElement).closest("a")) close();
                    }}
                >
                    <div className="bookmarkPopoverHeader">
                        <span className="bookmarkPopoverTitle">{tHome("classic.bookmarks.title")}</span>
                        <span className="bookmarkPopoverCount">{count}</span>
                        <span className="bookmarkPopoverKeys" aria-hidden="true">
                            <kbd>CTRL</kbd>
                            <kbd>SHIFT</kbd>
                            <kbd>B</kbd>
                        </span>
                    </div>
                    <div className="bookmarkPopoverList">
                        {count === 0 ? (
                            <p className="bookmarkPopoverEmpty">{tHome("classic.bookmarks.empty")}</p>
                        ) : (
                            <ol>
                                {rows.map((row) => (
                                    <BookmarkHistoryListItem
                                        key={`${row.itemLink}-${row.id}`}
                                        focused={false}
                                        isHistory={false}
                                        isBookmark={true}
                                        link={row.itemLink}
                                        id={row.id}
                                        bookmark={row}
                                    />
                                ))}
                            </ol>
                        )}
                    </div>
                </div>
            )}
        </Popover>
    );
};

export default BookmarkToggle;
