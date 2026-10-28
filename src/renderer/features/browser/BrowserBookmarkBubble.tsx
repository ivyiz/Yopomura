import { DEFAULT_BOOKMARK_CATEGORY } from "@common/types/browser";
import { faBookmark, faTrashCan, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useEffect, useMemo, useState } from "react";
import { canonicalCategoryName, cleanCategoryName } from "./browserBookmarks";
import "./browserBookmarkBubble.scss";

const NEW_CATEGORY = "__new_category__";

export type BookmarkBubbleDraft = {
    mode: "new" | "edit";
    /** Present when editing an existing bookmark. */
    bookmarkId?: string;
    url: string;
    title: string;
    favicon: string;
    category: string;
};

type BrowserBookmarkBubbleProps = {
    draft: BookmarkBubbleDraft;
    categories: string[];
    onSave: (values: { title: string; category: string }) => void;
    onRemove: () => void;
    onClose: () => void;
};

/** Brave-style bookmark editor anchored under the browser toolbar. */
const BrowserBookmarkBubble = ({ draft, categories, onSave, onRemove, onClose }: BrowserBookmarkBubbleProps) => {
    const [title, setTitle] = useState(draft.title);
    const [categoryChoice, setCategoryChoice] = useState(draft.category || DEFAULT_BOOKMARK_CATEGORY);
    const [newCategory, setNewCategory] = useState("");
    const [iconFailed, setIconFailed] = useState(false);

    // biome-ignore lint/correctness/useExhaustiveDependencies: reset the draft when the bubble target changes
    useEffect(() => {
        setTitle(draft.title);
        setCategoryChoice(draft.category || DEFAULT_BOOKMARK_CATEGORY);
        setNewCategory("");
        setIconFailed(false);
    }, [draft.url, draft.mode, draft.title, draft.category]);

    const options = useMemo(() => {
        const seen = new Set<string>();
        const rows: string[] = [];
        for (const category of [DEFAULT_BOOKMARK_CATEGORY, ...categories, draft.category]) {
            const cleaned = cleanCategoryName(category);
            if (seen.has(cleaned.toLowerCase())) continue;
            seen.add(cleaned.toLowerCase());
            rows.push(cleaned);
        }
        return rows;
    }, [categories, draft.category]);

    const selectedCategory = categoryChoice === NEW_CATEGORY ? newCategory : categoryChoice;
    const trimmedTitle = title.trim();
    const trimmedCategory = cleanCategoryName(selectedCategory);
    const canSave = Boolean(trimmedTitle) && (categoryChoice !== NEW_CATEGORY || Boolean(newCategory.trim()));

    const submit = () => {
        if (!canSave) return;
        onSave({
            title: trimmedTitle,
            category: canonicalCategoryName(trimmedCategory, categories),
        });
    };

    return (
        <>
            <div className="browserBookmarkBackdrop" onMouseDown={onClose} />
            <div className="browserBookmarkBubble" role="dialog" aria-label="Bookmark">
                <div className="browserBookmarkHeader">
                    <span className="browserBookmarkTitle">
                        <FontAwesomeIcon icon={faBookmark} aria-hidden />
                        {draft.mode === "new" ? "Add bookmark" : "Edit bookmark"}
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
                    <div className="browserBookmarkIntro">
                        <span className="browserBookmarkPreview" aria-hidden>
                            {draft.favicon && !iconFailed ? (
                                <img
                                    src={draft.favicon}
                                    alt=""
                                    draggable={false}
                                    onError={() => setIconFailed(true)}
                                />
                            ) : (
                                <FontAwesomeIcon icon={faBookmark} />
                            )}
                        </span>
                        <span className="browserBookmarkUrl" title={draft.url}>
                            {draft.url}
                        </span>
                    </div>

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
                        <span>Category</span>
                        <select
                            value={categoryChoice}
                            onChange={(event) => setCategoryChoice(event.currentTarget.value)}
                            aria-label="Bookmark category"
                        >
                            {options.map((category) => (
                                <option key={category} value={category}>
                                    {category}
                                </option>
                            ))}
                            <option value={NEW_CATEGORY}>New category…</option>
                        </select>
                    </div>

                    {categoryChoice === NEW_CATEGORY ? (
                        <div className="browserBookmarkField">
                            <span>New category</span>
                            <input
                                value={newCategory}
                                onChange={(event) => setNewCategory(event.currentTarget.value)}
                                placeholder="e.g. Research"
                                aria-label="New bookmark category"
                                spellCheck={false}
                            />
                        </div>
                    ) : null}

                    <div className="browserBookmarkFooter">
                        {draft.mode === "edit" ? (
                            <button
                                type="button"
                                className="browserBookmarkRemove"
                                onClick={onRemove}
                                title="Remove bookmark"
                            >
                                <FontAwesomeIcon icon={faTrashCan} aria-hidden />
                                Remove
                            </button>
                        ) : (
                            <span />
                        )}
                        <button type="submit" className="browserBookmarkDone" disabled={!canSave}>
                            Done
                        </button>
                    </div>
                </form>
            </div>
        </>
    );
};

export default BrowserBookmarkBubble;
