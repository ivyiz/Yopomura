import { describe, expect, it, vi } from "vitest";
import { applyBrowserEngine, BROWSER_ENGINE_EVENT, readBrowserEngine } from "./browserEngine";

const makeStorage = (initial?: string) => {
    const values = new Map<string, string>();
    if (initial !== undefined) values.set("yokomura-browser-engine", initial);
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        values,
    };
};

describe("browser search engine", () => {
    it("defaults to Brave for missing or invalid values", () => {
        expect(readBrowserEngine(makeStorage())).toBe("brave");
        expect(readBrowserEngine(makeStorage("bing"))).toBe("brave");
    });

    it("reads a saved engine", () => {
        expect(readBrowserEngine(makeStorage("duckduckgo"))).toBe("duckduckgo");
    });

    it("persists, calls main, and notifies listeners", () => {
        const storage = makeStorage();
        const invoke = vi.fn(async () => undefined);
        const listener = vi.fn();
        Object.defineProperty(window, "electron", {
            configurable: true,
            value: { invoke },
        });
        window.addEventListener(BROWSER_ENGINE_EVENT, listener);

        applyBrowserEngine("google", storage);

        expect(storage.values.get("yokomura-browser-engine")).toBe("google");
        expect(invoke).toHaveBeenCalledWith("browser:setSearchEngine", { engine: "google" });
        expect(listener).toHaveBeenCalledTimes(1);
        window.removeEventListener(BROWSER_ENGINE_EVENT, listener);
    });
});
