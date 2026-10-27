export type BrowserMode = "side" | "full";

export type OpenBrowserDetail = { mode: BrowserMode };

/** Open the integrated browser from anywhere in the app. */
export const openBrowser = (mode: BrowserMode): void => {
    window.dispatchEvent(new CustomEvent<OpenBrowserDetail>("yokomura:open-browser", { detail: { mode } }));
};
