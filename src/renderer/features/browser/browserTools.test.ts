import { describe, expect, it } from "vitest";
import {
    BROWSER_TOOL_IDS,
    DEFAULT_PINNED_TOOL_IDS,
    normalizePinnedToolIds,
    readPinnedToolIds,
    savePinnedToolIds,
} from "./browserTools";

const makeStorage = (initial?: string) => {
    const values = new Map<string, string>();
    if (initial !== undefined) values.set("yokomura-browser-pinned-tools", initial);
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        values,
    };
};

describe("browser toolbar pins", () => {
    it("defaults to every tool", () => {
        expect(readPinnedToolIds(makeStorage())).toEqual([...DEFAULT_PINNED_TOOL_IDS]);
    });

    it("keeps a valid empty layout", () => {
        expect(readPinnedToolIds(makeStorage("[]"))).toEqual([]);
        expect(normalizePinnedToolIds([])).toEqual([]);
    });

    it("filters unknown ids, removes duplicates and restores toolbar order", () => {
        expect(normalizePinnedToolIds(["scan", "nope", "bookmark", "scan"])).toEqual(["bookmark", "scan"]);
        expect(normalizePinnedToolIds("scan")).toEqual([...DEFAULT_PINNED_TOOL_IDS]);
    });

    it("falls back to defaults when the stored JSON is corrupt", () => {
        expect(readPinnedToolIds(makeStorage("{oops"))).toEqual([...DEFAULT_PINNED_TOOL_IDS]);
    });

    it("writes a normalized layout", () => {
        const storage = makeStorage();
        savePinnedToolIds(["external", "adblock", "external"], storage);
        expect(storage.values.get("yokomura-browser-pinned-tools")).toBe(JSON.stringify(["adblock", "external"]));
        expect(readPinnedToolIds(storage)).toEqual(["adblock", "external"]);
    });

    it("lists every id in the definition order", () => {
        expect([...BROWSER_TOOL_IDS]).toHaveLength(6);
        expect(DEFAULT_PINNED_TOOL_IDS).toEqual([...BROWSER_TOOL_IDS]);
    });
});
