import { describe, expect, it, vi } from "vitest";
import {
    DISABLED_HOSTS_EVENT,
    publishDisabledHosts,
    readDisabledHosts,
    readForceDark,
    saveDisabledHosts,
    saveForceDark,
} from "./browserDarkMode";

const makeStorage = (initial?: string) => {
    const values = new Map<string, string>();
    if (initial !== undefined) values.set("yokomura-browser-disabled-hosts", initial);
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        values,
    };
};

describe("browser force dark", () => {
    it("defaults to on and only stores an explicit off", () => {
        const storage = makeStorage();
        expect(readForceDark(storage)).toBe(true);
        saveForceDark(false, storage);
        expect(readForceDark(storage)).toBe(false);
        saveForceDark(true, storage);
        expect(readForceDark(storage)).toBe(true);
    });

    it("returns an empty list for corrupt or non-array values", () => {
        expect(readDisabledHosts(makeStorage("{nope"))).toEqual([]);
        expect(readDisabledHosts(makeStorage('{"host":"x"}'))).toEqual([]);
        expect(readDisabledHosts(makeStorage('[1,null,"a.com",""]'))).toEqual(["a.com"]);
    });

    it("persists the exception list and notifies in-window listeners", () => {
        const storage = makeStorage();
        const listener = vi.fn();
        window.addEventListener(DISABLED_HOSTS_EVENT, listener);
        try {
            publishDisabledHosts(["b.com", "a.com"], storage);
        } finally {
            window.removeEventListener(DISABLED_HOSTS_EVENT, listener);
        }

        expect(readDisabledHosts(storage)).toEqual(["b.com", "a.com"]);
        expect(storage.values.get("yokomura-browser-disabled-hosts")).toBe('["b.com","a.com"]');
        expect(listener).toHaveBeenCalledTimes(1);
        expect((listener.mock.calls[0][0] as CustomEvent<{ hosts: string[] }>).detail.hosts).toEqual([
            "b.com",
            "a.com",
        ]);
    });

    it("keeps writes non-fatal when storage is unavailable", () => {
        const storage = {
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("blocked");
            },
        };
        expect(readDisabledHosts(storage)).toEqual([]);
        expect(readForceDark(storage)).toBe(true);
        expect(() => saveDisabledHosts(["a.com"], storage)).not.toThrow();
        expect(() => saveForceDark(false, storage)).not.toThrow();
    });
});
