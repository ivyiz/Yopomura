import type { BrowserBookmark } from "@common/types/browser";
import { faBookmark, faTrashCan, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useState } from "react";
import "./browserBookmarkBubble.scss";

type BrowserBookmarkBubbleProps = {
    bookmark: BrowserBookmark;
    /** True right after adding; false when editing an existing bookmark. */
    created: boolean;
    onSave: (title: string) => void;
    onRemove: () => void;
    onClose: () => void;
};

/** Brave-style bookmark editor anchored under the browser toolbar. */
const BrowserBookmarkBubble = ({ bookmark, created, onSave, onRemove, onClose }: BrowserBookmarkBubbleProps) => {
    const [title, setTitle] = useState(bookmark.title);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset the draft when the bookmark or its title changes
    useEffect(() => {
        setTitle(bookmark.title);
    }, [bookmark.id, bookmark.title]);

    const trimmed = title.trim();
    const submit = () => {
        if (!trimmed) return;
        onSave(trimmed);
    };

    return (
        <>
            <div className="browserBookmarkBackdrop" onMouseDown={onClose} />
            <div className="browserBookmarkBubble" role="dialog" aria-label="Bookmark">
                <div className="browserBookmarkHeader">
                    <span className="browserBookmarkTitle">
                        <FontAwesomeIcon icon={faBookmark} aria-hidden />
                        {created ? "Bookmark added" : "Edit bookmark"}
                    </span>
                    <button
                        type="button"
                        className="browserBookmarkIconBtn"
                        title="Close"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>

                <form
                    className="browserBookmarkForm"
                    onSubmit={(event) => {
                        event.preventDefault();
                        submit();
                    }}
                >
                    <div className="browserBookmarkField">
                        <span>Name</span>
                        <input
                            value={title}
                            onChange={(event) => setTitle(event.currentTarget.value)}
                            onFocus={(event) => event.currentTarget.select()}
                            aria-label="Bookmark name"
                            spellCheck={false}
                            // biome-ignore lint/a11y/noAutofocus: the bubble is opened by an explicit bookmark action
                            autoFocus
                        />
                    </div>
                    <div className="browserBookmarkField">
                        <span>URL</span>
                        <span className="browserBookmarkUrl" title={bookmark.url}>
                            {bookmark.url}
                        </span>
                    </div>

                    <div className="browserBookmarkFooter">
                        <button
                            type="button"
                            className="browserBookmarkRemove"
                            onClick={onRemove}
                            title="Remove bookmark"
                        >
                            <FontAwesomeIcon icon={faTrashCan} aria-hidden />
                            Remove
                        </button>
                        <button type="submit" className="browserBookmarkDone" disabled={!trimmed}>
                            Done
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
};

export default BrowserBookmarkBubble;
