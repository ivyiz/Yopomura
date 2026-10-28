import type { BrowserSearchEngine } from "@common/types/browser";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { faGear, faNetworkWired, faPuzzlePiece, faThumbtack, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { BrowserToolId, BrowserToolKind } from "./browserTools";
import "./browserExtensions.scss";

/** One built-in tool as rendered in the extensions popover. */
export type BrowserToolEntry = {
    id: BrowserToolId;
    label: string;
    description: string;
    kind: BrowserToolKind;
    icon: IconDefinition;
    pinned: boolean;
    active: boolean;
    disabled: boolean;
    /** Short state label shown at the right edge, e.g. "On" or "Saved". */
    status?: string;
    onAction: () => void;
};

type BrowserExtensionsMenuProps = {
    engine: BrowserSearchEngine;
    onEngineChange: (engine: BrowserSearchEngine) => void;
    tools: BrowserToolEntry[];
    onTogglePin: (id: BrowserToolId) => void;
    onOpenSettings: (target: string) => void;
    onClose: () => void;
};

const ENGINE_LABEL: Record<BrowserSearchEngine, string> = {
    brave: "Brave",
    google: "Google",
    duckduckgo: "DuckDuckGo",
};

const ToolRow = ({ tool, onTogglePin }: { tool: BrowserToolEntry; onTogglePin: (id: BrowserToolId) => void }) => (
    <div className={`browserExtensionsRow ${tool.pinned ? "is-pinned" : ""}`} data-tool={tool.id}>
        <button
            type="button"
            className="browserExtensionsRowMain"
            data-action={tool.id}
            aria-pressed={tool.kind === "toggle" ? tool.active : undefined}
            disabled={tool.disabled}
            title={tool.description}
            onClick={tool.onAction}
        >
            <span className={`browserExtensionsToolIcon ${tool.active ? "is-on" : ""}`} aria-hidden>
                <FontAwesomeIcon icon={tool.icon} />
            </span>
            <span className="browserExtensionsToolLabel">{tool.label}</span>
            {tool.status ? (
                <span className={`browserExtensionsState ${tool.active ? "is-on" : ""}`}>{tool.status}</span>
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

/** Compact Chrome-style extensions popover for Yopomura's built-in tools. */
const BrowserExtensionsMenu = ({
    engine,
    onEngineChange,
    tools,
    onTogglePin,
    onOpenSettings,
    onClose,
}: BrowserExtensionsMenuProps) => {
    const pinnedTools = tools.filter((tool) => tool.pinned);
    const moreTools = tools.filter((tool) => !tool.pinned);

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

                <label className="browserExtensionsSearchRow">
                    <span>Search engine</span>
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

                <div className="browserExtensionsList">
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
                </div>

                <div className="browserExtensionsFooter">
                    <button
                        type="button"
                        className="browserExtensionsFooterLink"
                        data-settings="setting:browser"
                        onClick={() => onOpenSettings("setting:browser")}
                    >
                        <FontAwesomeIcon icon={faGear} aria-hidden />
                        <span>Browser settings</span>
                    </button>
                    <button
                        type="button"
                        className="browserExtensionsFooterLink"
                        data-settings="setting:browser-proxy"
                        onClick={() => onOpenSettings("setting:browser-proxy")}
                    >
                        <FontAwesomeIcon icon={faNetworkWired} aria-hidden />
                        <span>Proxy settings</span>
                    </button>
                </div>
            </div>
        </>
    );
};

export default BrowserExtensionsMenu;
