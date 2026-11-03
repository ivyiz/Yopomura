export type BrowserMode = "side" | "full";

export type ToggleBrowserDetail = { mode: BrowserMode };

export type OpenBrowserDetail = { url?: string; mode?: BrowserMode };

/**
 * Asks the browser shell to toggle a mode: opens it when closed, closes it when
 * the same mode is already open, and switches modes otherwise.
 */
export const toggleBrowser = (mode: BrowserMode): void => {
    window.dispatchEvent(new CustomEvent<ToggleBrowserDetail>("yokomura:toggle-browser", { detail: { mode } }));
};

/**
 * Ensures the browser is open in the given mode (default full) and optionally navigates to a URL.
 */
export const openBrowser = (detail?: OpenBrowserDetail): void => {
    window.dispatchEvent(new CustomEvent<OpenBrowserDetail>("yokomura:open-browser", { detail }));
};

/** Closes the browser regardless of its current mode, keeping its tabs alive. */
export const closeBrowser = (): void => {
    window.dispatchEvent(new Event("yokomura:close-browser"));
};
