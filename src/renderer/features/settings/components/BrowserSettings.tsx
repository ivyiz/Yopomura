import type { BrowserSearchEngine } from "@common/types/browser";
import {
    applyBrowserEngine,
    BROWSER_ENGINE_EVENT,
    ENGINE_LABEL,
    readBrowserEngine,
} from "@features/browser/browserEngine";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "./browserSettings.scss";

/** Settings section for browser-wide preferences shared with the toolbar popover. */
const BrowserSettings = () => {
    const { t } = useTranslation("settings");
    const [engine, setEngine] = useState<BrowserSearchEngine>(readBrowserEngine);

    useEffect(() => {
        const onEngineChange = (event: Event) => {
            const detail = (event as CustomEvent<{ engine?: BrowserSearchEngine }>).detail;
            if (detail?.engine) setEngine(detail.engine);
        };
        window.addEventListener(BROWSER_ENGINE_EVENT, onEngineChange);
        return () => window.removeEventListener(BROWSER_ENGINE_EVENT, onEngineChange);
    }, []);

    const changeEngine = (next: BrowserSearchEngine) => {
        setEngine(next);
        applyBrowserEngine(next);
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
        </div>
    );
};

export default BrowserSettings;
