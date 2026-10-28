import type { BrowserSearchEngine } from "@common/types/browser";
import type { ProxyState } from "@common/types/network";
import { faPuzzlePiece, faThumbtack, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useAppDispatch } from "@store/hooks";
import { requestSettingsNav } from "@store/ui";
import { useEffect, useState } from "react";
import type { BrowserToolId, BrowserToolKind } from "./browserTools";
import "./browserExtensions.scss";

/** One built-in tool as rendered in the extensions popover. */
export type BrowserToolEntry = {
    id: BrowserToolId;
    label: string;
    description: string;
    kind: BrowserToolKind;
    pinned: boolean;
    active: boolean;
    disabled: boolean;
    onAction: () => void;
};

type BrowserExtensionsMenuProps = {
    engine: BrowserSearchEngine;
    onEngineChange: (engine: BrowserSearchEngine) => void;
    tools: BrowserToolEntry[];
    onTogglePin: (id: BrowserToolId) => void;
    onResetPins: () => void;
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

const ToolRow = ({ tool, onTogglePin }: { tool: BrowserToolEntry; onTogglePin: (id: BrowserToolId) => void }) => (
    <div className={`browserExtensionsRow ${tool.pinned ? "is-pinned" : ""}`} data-tool={tool.id}>
        <button
            type="button"
            className="browserExtensionsRowMain"
            data-action={tool.id}
            aria-pressed={tool.kind === "toggle" ? tool.active : undefined}
            disabled={tool.disabled}
            onClick={tool.onAction}
        >
            <span className="browserExtensionsRowText">
                <strong>{tool.label}</strong>
                <small>{tool.description}</small>
            </span>
            {tool.kind === "toggle" ? (
                <span className={`browserExtensionsSwitch ${tool.active ? "is-on" : ""}`} aria-hidden>
                    <span />
                </span>
            ) : null}
        </button>
        <button
            type="button"
            className={`browserExtensionsPin ${tool.pinned ? "is-pinned" : ""}`}
            data-pin={tool.id}
            aria-label={tool.pinned ? `Unpin ${tool.label}` : `Pin ${tool.label}`}
            aria-pressed={tool.pinned}
            title={tool.pinned ? "Unpin from toolbar" : "Pin to toolbar"}
            onClick={() => onTogglePin(tool.id)}
        >
            <FontAwesomeIcon icon={faThumbtack} aria-hidden />
        </button>
    </div>
);

/** Chrome-style extensions popover holding Yokomura's built-in browser tools. */
const BrowserExtensionsMenu = ({
    engine,
    onEngineChange,
    tools,
    onTogglePin,
    onResetPins,
    onClose,
}: BrowserExtensionsMenuProps) => {
    const dispatch = useAppDispatch();
    const [proxy, setProxy] = useState<ProxyState | null>(null);
    const pinnedTools = tools.filter((tool) => tool.pinned);
    const moreTools = tools.filter((tool) => !tool.pinned);

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

                    {pinnedTools.length > 0 ? (
                        <div className="browserExtensionsSection">
                            <div className="browserExtensionsSectionTitle">
                                <span>Pinned to toolbar</span>
                                <span>{pinnedTools.length}</span>
                            </div>
                            {pinnedTools.map((tool) => (
                                <ToolRow key={tool.id} tool={tool} onTogglePin={onTogglePin} />
                            ))}
                        </div>
                    ) : null}

                    {moreTools.length > 0 ? (
                        <div className="browserExtensionsSection">
                            <div className="browserExtensionsSectionTitle">
                                <span>More tools</span>
                                <span>{moreTools.length}</span>
                            </div>
                            {moreTools.map((tool) => (
                                <ToolRow key={tool.id} tool={tool} onTogglePin={onTogglePin} />
                            ))}
                        </div>
                    ) : null}

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

                <div className="browserExtensionsFooter">
                    <p className="browserExtensionsNote">
                        Built-in tools only. Chrome Web Store extensions are not supported in this build.
                    </p>
                    <button type="button" className="browserExtensionsReset" onClick={onResetPins}>
                        Reset toolbar
                    </button>
                </div>
            </div>
        </>
    );
};

export default BrowserExtensionsMenu;
