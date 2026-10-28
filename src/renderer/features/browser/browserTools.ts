/** Built-in browser tools that can be pinned to the toolbar. */
export const BROWSER_TOOL_IDS = ["bookmark", "forceDark", "adblock", "download", "scan", "external"] as const;

export type BrowserToolId = (typeof BROWSER_TOOL_IDS)[number];

export type BrowserToolKind = "toggle" | "action";

export type BrowserToolDefinition = {
    id: BrowserToolId;
    label: string;
    description: string;
    kind: BrowserToolKind;
};

/** Toolbar tools in display order. */
export const BROWSER_TOOLS: readonly BrowserToolDefinition[] = [
    {
        id: "bookmark",
        label: "Bookmark this tab",
        description: "Save this page so you can open it again later.",
        kind: "action",
    },
    {
        id: "forceDark",
        label: "Dark mode on this site",
        description: "Force the current site to use a dark theme.",
        kind: "toggle",
    },
    {
        id: "adblock",
        label: "Ad blocking",
        description: "Hide ads and trackers on every page.",
        kind: "toggle",
    },
    {
        id: "download",
        label: "Add page to Downloader",
        description: "Queue this page with your default folder.",
        kind: "action",
    },
    {
        id: "scan",
        label: "Scan links",
        description: "Find downloadable links on this page.",
        kind: "action",
    },
    {
        id: "external",
        label: "Open in default browser",
        description: "Open the current page outside Yokomura.",
        kind: "action",
    },
];

export const DEFAULT_PINNED_TOOL_IDS: readonly BrowserToolId[] = [...BROWSER_TOOL_IDS];

const STORAGE_KEY = "yokomura-browser-pinned-tools";

type PinnedStorage = Pick<Storage, "getItem" | "setItem">;

const isToolId = (value: unknown): value is BrowserToolId =>
    typeof value === "string" && (BROWSER_TOOL_IDS as readonly string[]).includes(value);

/**
 * Returns unique tool ids in toolbar order. Invalid ids are ignored; an empty
 * array is a valid "everything unpinned" state.
 */
export const normalizePinnedToolIds = (value: unknown): BrowserToolId[] => {
    if (!Array.isArray(value)) return [...DEFAULT_PINNED_TOOL_IDS];
    const selected = new Set(value.filter(isToolId));
    return BROWSER_TOOL_IDS.filter((id) => selected.has(id));
};

/** Loads the persisted pin layout; missing or corrupt data falls back to all tools. */
export const readPinnedToolIds = (storage: PinnedStorage = window.localStorage): BrowserToolId[] => {
    try {
        const raw = storage.getItem(STORAGE_KEY);
        if (raw === null) return [...DEFAULT_PINNED_TOOL_IDS];
        return normalizePinnedToolIds(JSON.parse(raw));
    } catch {
        return [...DEFAULT_PINNED_TOOL_IDS];
    }
};

export const savePinnedToolIds = (
    ids: readonly BrowserToolId[],
    storage: PinnedStorage = window.localStorage,
): void => {
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(normalizePinnedToolIds(ids)));
    } catch {
        // localStorage can be unavailable in hardened profiles; pins are cosmetic.
    }
};

/** Definition for one id, or `undefined` for an unknown value. */
export const browserToolDefinition = (id: BrowserToolId): BrowserToolDefinition | undefined =>
    BROWSER_TOOLS.find((tool) => tool.id === id);
