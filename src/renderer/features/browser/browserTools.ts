import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faFileArrowDown, faLink, faShieldHalved, faUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";

/** Built-in browser tools that can be pinned to the toolbar. */
export const BROWSER_TOOL_IDS = ["adblock", "download", "scan", "external"] as const;

export type BrowserToolId = (typeof BROWSER_TOOL_IDS)[number];

export type BrowserToolKind = "toggle" | "action";

export type BrowserToolDefinition = {
    id: BrowserToolId;
    label: string;
    description: string;
    kind: BrowserToolKind;
    icon: IconDefinition;
};

/** Toolbar tools in display order. */
export const BROWSER_TOOLS: readonly BrowserToolDefinition[] = [
    {
        id: "adblock",
        label: "Ad blocking",
        description: "Hide ads and trackers on every page.",
        kind: "toggle",
        icon: faShieldHalved,
    },
    {
        id: "download",
        label: "Send page to Downloader",
        description: "Open this page in the Downloader so you can choose the folder and options.",
        kind: "action",
        icon: faFileArrowDown,
    },
    {
        id: "scan",
        label: "Scan links",
        description: "Find downloadable links on this page.",
        kind: "action",
        icon: faLink,
    },
    {
        id: "external",
        label: "Open in default browser",
        description: "Open the current page outside Yopomura.",
        kind: "action",
        icon: faUpRightFromSquare,
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
