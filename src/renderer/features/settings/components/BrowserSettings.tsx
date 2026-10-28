import type { BrowserSearchEngine } from "@common/types/browser";
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
        </div>
    );
};

export default BrowserSettings;
