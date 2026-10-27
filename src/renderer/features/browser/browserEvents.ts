export type BrowserMode = "side" | "full";

export type ToggleBrowserDetail = { mode: BrowserMode };

/**
 * Asks the browser shell to toggle a mode: opens it when closed, closes it when
 * the same mode is already open, and switches modes otherwise.
 */
export const toggleBrowser = (mode: BrowserMode): void => {
    window.dispatchEvent(new CustomEvent<ToggleBrowserDetail>("yokomura:toggle-browser", { detail: { mode } }));
};
