import type { BrowserAdblockState, BrowserSearchEngine } from "@common/types/browser";
import {
    DISABLED_HOSTS_EVENT,
    publishDisabledHosts,
    readDisabledHosts,
    readForceDark,
    saveForceDark,
} from "@features/browser/browserDarkMode";
import {
    applyBrowserEngine,
    BROWSER_ENGINE_EVENT,
    ENGINE_LABEL,
    readBrowserEngine,
} from "@features/browser/browserEngine";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./browserSettings.scss";

const mergeHosts = (first: readonly string[], second: readonly string[]): string[] =>
    [...new Set([...first, ...second])].sort();

/** Settings section for browser-wide preferences shared with the toolbar popover. */
const BrowserSettings = () => {
    const { t } = useTranslation("settings");
    const [engine, setEngine] = useState<BrowserSearchEngine>(readBrowserEngine);
    const [forceDark, setForceDark] = useState(readForceDark);
    const [disabledHosts, setDisabledHosts] = useState<string[]>(readDisabledHosts);
    const [adblock, setAdblock] = useState<BrowserAdblockState | null>(null);
    const [adblockBusy, setAdblockBusy] = useState(false);
    const [customFilters, setCustomFilters] = useState("");
    const [customFiltersStatus, setCustomFiltersStatus] = useState("");

    useEffect(() => {
        let cancelled = false;
        void window.electron.invoke("browser:getAdblockFilters").then((text) => {
            if (!cancelled) setCustomFilters(text);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        void window.electron.invoke("browser:getAdblock").then((state) => {
            if (!cancelled) setAdblock(state);
        });
        const off = window.electron.on("browser:adblockState", (state) => setAdblock(state));
        return () => {
            cancelled = true;
            off();
        };
    }, []);

    useEffect(() => {
        const onEngineChange = (event: Event) => {
            const detail = (event as CustomEvent<{ engine?: BrowserSearchEngine }>).detail;
            if (detail?.engine) setEngine(detail.engine);
        };
        window.addEventListener(BROWSER_ENGINE_EVENT, onEngineChange);
        return () => window.removeEventListener(BROWSER_ENGINE_EVENT, onEngineChange);
    }, []);

    useEffect(() => {
        const onHostsChange = (event: Event) => {
            const detail = (event as CustomEvent<{ hosts?: string[] }>).detail;
            if (Array.isArray(detail?.hosts)) setDisabledHosts(detail.hosts);
        };
        window.addEventListener(DISABLED_HOSTS_EVENT, onHostsChange);
        return () => window.removeEventListener(DISABLED_HOSTS_EVENT, onHostsChange);
    }, []);

    useEffect(() => {
        let cancelled = false;
        void window.electron
            .invoke("browser:getDisabledHosts")
            .then((hosts) => {
                if (!cancelled) setDisabledHosts((previous) => mergeHosts(previous, hosts));
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const changeEngine = (next: BrowserSearchEngine) => {
        setEngine(next);
        applyBrowserEngine(next);
    };

    const changeForceDark = (enabled: boolean) => {
        setForceDark(enabled);
        saveForceDark(enabled);
        void window.electron.invoke("browser:setForceDark", { enabled });
    };

    const changeAdblock = (enabled: boolean) => {
        void window.electron.invoke("browser:setAdblock", { enabled }).then((state) => setAdblock(state));
    };

    const resetAdblockStats = () => {
        void window.electron.invoke("browser:resetAdblockStats").then((state) => setAdblock(state));
    };

    const updateAdblockLists = () => {
        setAdblockBusy(true);
        void window.electron
            .invoke("browser:updateAdblock")
            .then((state) => setAdblock(state))
            .finally(() => setAdblockBusy(false));
    };

    const saveCustomFilters = () => {
        void window.electron.invoke("browser:setAdblockFilters", { text: customFilters }).then((state) => {
            setAdblock(state);
            setCustomFiltersStatus(t("browser.adblockCustomFiltersSaved"));
        });
    };

    const enableAdblockForHost = (host: string) => {
        void window.electron
            .invoke("browser:setAdblockException", { host, disabled: false })
            .then((state) => setAdblock(state));
    };

    const enableForHost = async (host: string) => {
        const next = disabledHosts.filter((row) => row !== host);
        setDisabledHosts(next);
        publishDisabledHosts(next);
        try {
            await window.electron.invoke("browser:setHostForceDark", { hostOrUrl: host, enabled: true });
        } catch {
            // The main process may not have a browser manager yet; localStorage
            // still restores the exception list on the next browser launch.
        }
    };

    return (
        <div className="settingItem2" id="settings-browser">
            <h3>{t("browser.title")}</h3>
            <div className="desc">{t("browser.desc")}</div>
            <div className="browserSettingRow">
                <span>{t("browser.searchEngine")}</span>
                <select
                    value={engine}
                    onChange={(event) => changeEngine(event.currentTarget.value as BrowserSearchEngine)}
                    aria-label={t("browser.searchEngine")}
                >
                    {Object.entries(ENGINE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </div>
            <div className="browserSettingRow">
                <span>{t("browser.forceDark")}</span>
                <input
                    type="checkbox"
                    checked={forceDark}
                    onChange={(event) => changeForceDark(event.currentTarget.checked)}
                    aria-label={t("browser.forceDark")}
                />
            </div>
            <div className="browserSettingHint">{t("browser.forceDarkDesc")}</div>
            <div className="browserSettingSubhead">{t("browser.exceptions")}</div>
            {disabledHosts.length === 0 ? (
                <div className="browserSettingHint">{t("browser.noExceptions")}</div>
            ) : (
                <div className="browserExceptionList">
                    {disabledHosts.map((host) => (
                        <div className="browserExceptionRow" key={host}>
                            <span>{host}</span>
                            <button type="button" onClick={() => void enableForHost(host)}>
                                {t("browser.enableSite")}
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="browserSettingSubhead">{t("browser.adblockTitle")}</div>
            <div className="browserSettingRow">
                <span>{t("browser.adblockTitle")}</span>
                <input
                    type="checkbox"
                    checked={adblock?.enabled ?? true}
                    onChange={(event) => changeAdblock(event.currentTarget.checked)}
                    aria-label={t("browser.adblockTitle")}
                />
            </div>
            <div className="browserSettingHint">
                {adblock?.mode === "fallback"
                    ? t("browser.adblockFallback")
                    : adblock?.mode === "prebuilt"
                      ? t("browser.adblockPrebuilt")
                      : t("browser.adblockDesc")}
            </div>
            <div className="browserSettingHint">
                {t("browser.adblockBlocked", { count: adblock?.blocked ?? 0 })}
                {adblock?.listsUpdatedAt
                    ? ` · ${t("browser.adblockUpdated", {
                          date: new Date(adblock.listsUpdatedAt).toLocaleString(),
                      })}`
                    : ""}
            </div>
            <div className="browserSettingRow">
                <span>{t("browser.adblockExceptions")}</span>
                <span className="browserAdblockActions">
                    <button type="button" disabled={adblockBusy} onClick={updateAdblockLists}>
                        {adblockBusy ? t("browser.adblockUpdating") : t("browser.adblockUpdate")}
                    </button>
                    <button type="button" onClick={resetAdblockStats}>
                        {t("browser.adblockReset")}
                    </button>
                </span>
            </div>
            {adblock && adblock.exceptions.length > 0 ? (
                <div className="browserExceptionList">
                    {adblock.exceptions.map((host) => (
                        <div className="browserExceptionRow" key={host}>
                            <span>{host}</span>
                            <button type="button" onClick={() => enableAdblockForHost(host)}>
                                {t("browser.enableSite")}
                            </button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="browserSettingHint">{t("browser.adblockNoExceptions")}</div>
            )}

            <div className="browserSettingSubhead">{t("browser.adblockCustomFilters")}</div>
            <div className="browserSettingHint">{t("browser.adblockCustomFiltersDesc")}</div>
            <textarea
                className="browserAdblockFilterInput"
                value={customFilters}
                spellCheck={false}
                placeholder={"! One uBO rule per line\n||ads.example^$image\n##.ad-banner"}
                onChange={(event) => {
                    setCustomFilters(event.currentTarget.value);
                    setCustomFiltersStatus("");
                }}
            />
            <div className="browserSettingRow">
                <span>{customFiltersStatus}</span>
                <button type="button" onClick={saveCustomFilters}>
                    {t("browser.adblockCustomFiltersSave")}
                </button>
            </div>
        </div>
    );
};

export default BrowserSettings;
