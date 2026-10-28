const FORCE_DARK_KEY = "yokomura-browser-force-dark";
const DISABLED_HOSTS_KEY = "yokomura-browser-disabled-hosts";

/** Fired in-window when the dark-mode site exception list changes. */
export const DISABLED_HOSTS_EVENT = "yokomura-browser-disabled-hosts-changed";

type DarkStorage = Pick<Storage, "getItem" | "setItem">;

/** Force-dark defaults to on; "off" is the only stored disabled value. */
export const readForceDark = (storage: DarkStorage = window.localStorage): boolean => {
    try {
        return storage.getItem(FORCE_DARK_KEY) !== "off";
    } catch {
        return true;
    }
};

export const saveForceDark = (enabled: boolean, storage: DarkStorage = window.localStorage): void => {
    try {
        storage.setItem(FORCE_DARK_KEY, enabled ? "on" : "off");
    } catch {
        // localStorage can be unavailable; the main process still gets the value.
    }
};

const isHost = (value: unknown): value is string => typeof value === "string" && value.length > 0;

/** Hosts with forced dark disabled, persisted for the next browser launch. */
export const readDisabledHosts = (storage: DarkStorage = window.localStorage): string[] => {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(DISABLED_HOSTS_KEY) ?? "[]");
        return Array.isArray(parsed) ? parsed.filter(isHost) : [];
    } catch {
        return [];
    }
};

export const saveDisabledHosts = (hosts: readonly string[], storage: DarkStorage = window.localStorage): void => {
    try {
        storage.setItem(DISABLED_HOSTS_KEY, JSON.stringify(hosts));
    } catch {
        // See saveForceDark.
    }
};

/** Persists the list and notifies listeners in this window. */
export const publishDisabledHosts = (
    hosts: readonly string[],
    storage: DarkStorage = window.localStorage,
): void => {
    saveDisabledHosts(hosts, storage);
    window.dispatchEvent(new CustomEvent(DISABLED_HOSTS_EVENT, { detail: { hosts: [...hosts] } }));
};
