import type { BrowserSearchEngine } from "@common/types/browser";

/** Human-readable labels shared by the toolbar, New Tab, and Settings. */
export const ENGINE_LABEL: Record<BrowserSearchEngine, string> = {
    brave: "Brave",
    google: "Google",
    duckduckgo: "DuckDuckGo",
};

/** Fired in this renderer after the search engine changes anywhere in the app. */
export const BROWSER_ENGINE_EVENT = "yokomura:browser-engine";

const STORAGE_KEY = "yokomura-browser-engine";

type EngineStorage = Pick<Storage, "getItem" | "setItem">;

const isEngine = (value: unknown): value is BrowserSearchEngine =>
    value === "brave" || value === "google" || value === "duckduckgo";

/** Reads the saved search engine; invalid or missing values fall back to Brave. */
export const readBrowserEngine = (storage: EngineStorage = window.localStorage): BrowserSearchEngine => {
    try {
        const saved = storage.getItem(STORAGE_KEY);
        return isEngine(saved) ? saved : "brave";
    } catch {
        return "brave";
    }
};

/**
 * Persists a new engine, tells the main process, and notifies every browser
 * surface in this window. Settings and the Extensions popover both call this.
 */
export const applyBrowserEngine = (
    engine: BrowserSearchEngine,
    storage: EngineStorage = window.localStorage,
): void => {
    try {
        storage.setItem(STORAGE_KEY, engine);
    } catch {
        // localStorage can be unavailable; the main process still gets the value.
    }
    void window.electron.invoke("browser:setSearchEngine", { engine });
    window.dispatchEvent(new CustomEvent(BROWSER_ENGINE_EVENT, { detail: { engine } }));
};
