import type { BrowserSearchEngine } from "@common/types/browser";
import type { ProxyState } from "@common/types/network";
import { faPuzzlePiece, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppDispatch } from "@store/hooks";
import { requestSettingsNav } from "@store/ui";
import { useEffect, useState } from "react";
import "./browserExtensions.scss";

type BrowserExtensionsMenuProps = {
    engine: BrowserSearchEngine;
    onEngineChange: (engine: BrowserSearchEngine) => void;
    adblockEnabled: boolean;
    onToggleAdblock: () => void;
    /** Force-dark is enabled for the active host. */
    darkEnabled: boolean;
    /** False on the New Tab page where there is no host to toggle. */
    darkAvailable: boolean;
    onToggleDark: () => void;
    /** False on the New Tab page where page actions do not apply. */
    canUsePage: boolean;
    onScanLinks: () => void;
    onAddPage: () => void;
    onClose: () => void;
};

const ENGINE_LABEL: Record<BrowserSearchEngine, string> = {
    brave: "Brave",
    google: "Google",
    duckduckgo: "DuckDuckGo",
};

const proxySummary = (state: ProxyState | null): string => {
    if (!state) return "Checking…";
    const { config, applied } = state;
    if (config.mode === "direct") return "Direct connection (no proxy)";
    if (config.mode === "system") return "Following the Windows system proxy";
    const rules = `${config.protocol.toUpperCase()} · ${config.host}:${config.port}`;
    return applied ? rules : `${rules} · not applied`;
};

/** Chrome-style extensions popover holding Yokomura's built-in browser tools. */
const BrowserExtensionsMenu = ({
    engine,
    onEngineChange,
    adblockEnabled,
    onToggleAdblock,
    darkEnabled,
    darkAvailable,
    onToggleDark,
    canUsePage,
    onScanLinks,
    onAddPage,
    onClose,
}: BrowserExtensionsMenuProps) => {
    const dispatch = useAppDispatch();
    const [proxy, setProxy] = useState<ProxyState | null>(null);

    useEffect(() => {
        let cancelled = false;
        void window.electron
            .invoke("network:getProxy")
            .then((next) => {
                if (!cancelled) setProxy(next);
            })
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, []);

    const openProxySettings = () => {
        onClose();
        dispatch(requestSettingsNav("setting:browser-proxy"));
    };

    return (
        <>
            <div className="browserExtensionsBackdrop" onMouseDown={onClose} />
            <div className="browserExtensions" role="dialog" aria-label="Extensions">
                <div className="browserExtensionsHeader">
                    <span className="browserExtensionsTitle">
                        <FontAwesomeIcon icon={faPuzzlePiece} aria-hidden />
                        Extensions
                    </span>
                    <button
                        type="button"
                        className="browserExtensionsClose"
                        title="Close"
                        aria-label="Close"
                        onClick={onClose}
                    >
                        <FontAwesomeIcon icon={faXmark} />
                    </button>
                </div>

                <div className="browserExtensionsList">
                    <label className="browserExtensionsSelectRow">
                        <span className="browserExtensionsRowText">
                            <strong>Search engine</strong>
                            <small>Used by the address bar and New Tab.</small>
                        </span>
                        <select
                            className="browserExtensionsSelect"
                            value={engine}
                            onChange={(event) => onEngineChange(event.currentTarget.value as BrowserSearchEngine)}
                            aria-label="Search engine"
                        >
                            {Object.entries(ENGINE_LABEL).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <button
                        type="button"
                        className="browserExtensionsRow"
                        data-action="adblock"
                        aria-pressed={adblockEnabled}
                        onClick={onToggleAdblock}
                    >
                        <span className="browserExtensionsRowText">
                            <strong>Ad blocking</strong>
                            <small>Hide ads and trackers on every page.</small>
                        </span>
                        <span className={`browserExtensionsSwitch ${adblockEnabled ? "is-on" : ""}`} aria-hidden>
                            <span />
                        </span>
                    </button>

                    <button
                        type="button"
                        className="browserExtensionsRow"
                        data-action="dark"
                        aria-pressed={darkEnabled}
                        disabled={!darkAvailable}
                        onClick={onToggleDark}
                    >
                        <span className="browserExtensionsRowText">
                            <strong>Dark mode on this site</strong>
                            <small>
                                {darkAvailable
                                    ? darkEnabled
                                        ? "Forced dark is on."
                                        : "Disabled for this site."
                                    : "Open a page first."}
                            </small>
                        </span>
                        <span className={`browserExtensionsSwitch ${darkEnabled ? "is-on" : ""}`} aria-hidden>
                            <span />
                        </span>
                    </button>

                    <div className="browserExtensionsSeparator" aria-hidden />

                    <button
                        type="button"
                        className="browserExtensionsRow is-action"
                        data-action="scan"
                        disabled={!canUsePage}
                        onClick={onScanLinks}
                    >
                        <span className="browserExtensionsRowText">
                            <strong>Scan links</strong>
                            <small>Find downloadable links on this page.</small>
                        </span>
                    </button>

                    <button
                        type="button"
                        className="browserExtensionsRow is-action"
                        data-action="download"
                        disabled={!canUsePage}
                        onClick={onAddPage}
                    >
                        <span className="browserExtensionsRowText">
                            <strong>Add page to Downloader</strong>
                            <small>Queue this page with your default folder.</small>
                        </span>
                    </button>

                    <div className="browserExtensionsSeparator" aria-hidden />

                    <div className="browserExtensionsProxy">
                        <span className="browserExtensionsRowText">
                            <strong>Proxy</strong>
                            <small>{proxySummary(proxy)}</small>
                        </span>
                        <button type="button" className="browserExtensionsSettingsBtn" onClick={openProxySettings}>
                            Settings
                        </button>
                    </div>
                </div>

                <p className="browserExtensionsNote">
                    Built-in tools only. Chrome Web Store extensions are not supported in this build.
                </p>
            </div>
        </>
    );
};

export default BrowserExtensionsMenu;
