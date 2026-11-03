import { faDownload, faFolderOpen, faPlay } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import MediaThumbnail from "./MediaThumbnail";
import { formatTime, type VideoEntry, type WatchedPosition } from "./mediaLibrary";
import type { RecentFolder } from "./mediaRecents";

type ContinueItem = { entry: VideoEntry; position: WatchedPosition };
type RecentDownloadItem = { entry: VideoEntry; downloadedAt: number };

export type MediaHomeProps = {
    scanning: boolean;
    scanNote: string;
    onCancelScan: () => void;
    continueItems: ContinueItem[];
    recentlyDownloaded: RecentDownloadItem[];
    recentFolders: RecentFolder[];
    customRoot: string;
    onSelectVideo: (path: string) => void;
    onOpenFolder: (path: string) => void;
    onChooseFolder: () => void;
    onUseLibrary: () => void;
};

const clamp01 = (value: number): number => {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
};

const folderName = (path: string): string => {
    const normalized = path.replaceAll("\\", "/").replace(/\/+$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1) || path;
};

/**
 * Media panel landing view.
 *
 * Order is deliberate: recent folders first, the add-video card right below them,
 * downloaded history, then Continue Playing, and a full-width drop target that
 * fills the remaining height instead of leaving an empty black area.
 */
const MediaHome = ({
    scanning,
    scanNote,
    onCancelScan,
    continueItems,
    recentlyDownloaded,
    recentFolders,
    customRoot,
    onSelectVideo,
    onOpenFolder,
    onChooseFolder,
    onUseLibrary,
}: MediaHomeProps) => {
    return (
        <div className="mediaPanelHome">
            {scanning ? (
                <section className="mediaPanelHomeSection" aria-live="polite">
                    <div className="mediaPanelHomeScanning">
                        <span className="mediaPanelSpinner" aria-hidden />
                        <span className="mediaPanelBlankTitle">Scanning your videos...</span>
                        <span className="mediaPanelBlankText">{scanNote}</span>
                        <button type="button" className="mediaPanelButton is-ghost" onClick={onCancelScan}>
                            Cancel
                        </button>
                    </div>
                </section>
            ) : null}

            {recentFolders.length > 0 ? (
                <section className="mediaPanelHomeSection" aria-labelledby="mediaPanelHomeFolders">
                    <div className="mediaPanelSectionHead">
                        <h2 id="mediaPanelHomeFolders" className="mediaPanelSectionTitle">
                            <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
                            <span>Recent Folders</span>
                        </h2>
                    </div>
                    <div className="mediaPanelFolderList">
                        {recentFolders.map((folder) => (
                            <button
                                key={folder.path}
                                type="button"
                                className="mediaPanelFolderChip"
                                title={folder.path}
                                onClick={() => onOpenFolder(folder.path)}
                            >
                                <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
                                <span className="mediaPanelFolderChipBody">
                                    <span className="mediaPanelFolderChipName">{folderName(folder.path)}</span>
                                    <span className="mediaPanelFolderChipPath">{folder.path}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}

            <section className="mediaPanelHomeSection mediaPanelHomeDrop" aria-label="Add videos">
                <FontAwesomeIcon icon={faFolderOpen} className="mediaPanelBlankIcon" aria-hidden />
                <div className="mediaPanelHomeDropBody">
                    <span className="mediaPanelBlankTitle">Add videos</span>
                    <span className="mediaPanelBlankText">
                        Drop a video folder or an MP4/WebM file here, or choose a folder.
                    </span>
                </div>
                <div className="mediaPanelBlankActions">
                    <button type="button" className="mediaPanelButton" onClick={onChooseFolder}>
                        Choose folder
                    </button>
                    {customRoot ? (
                        <button type="button" className="mediaPanelButton is-ghost" onClick={onUseLibrary}>
                            Back to library
                        </button>
                    ) : null}
                </div>
            </section>

            {recentlyDownloaded.length > 0 ? (
                <section className="mediaPanelHomeSection" aria-labelledby="mediaPanelHomeDownloaded">
                    <div className="mediaPanelSectionHead">
                        <h2 id="mediaPanelHomeDownloaded" className="mediaPanelSectionTitle">
                            <FontAwesomeIcon icon={faDownload} aria-hidden />
                            <span>Recently Downloaded</span>
                        </h2>
                    </div>
                    <div className="mediaPanelHomeGrid">
                        {recentlyDownloaded.map(({ entry }) => (
                            <button
                                key={entry.path}
                                type="button"
                                className="mediaPanelHomeVideoCard"
                                title={`${entry.title}\n${entry.path}`}
                                onClick={() => onSelectVideo(entry.path)}
                            >
                                <MediaThumbnail path={entry.path} className="mediaPanelHomeArt" />
                                <span className="mediaPanelHomeVideoBody">
                                    <span className="mediaPanelHomeVideoTitle">{entry.title}</span>
                                    <span className="mediaPanelHomeVideoMeta">Downloaded</span>
                                </span>
                            </button>
                        ))}
                    </div>
                </section>
            ) : null}

            {continueItems.length > 0 ? (
                <section className="mediaPanelHomeSection" aria-labelledby="mediaPanelHomeContinue">
                    <div className="mediaPanelSectionHead">
                        <h2 id="mediaPanelHomeContinue" className="mediaPanelSectionTitle">
                            <FontAwesomeIcon icon={faPlay} aria-hidden />
                            <span>Continue Playing</span>
                        </h2>
                    </div>
                    <div className="mediaPanelContinueRow">
                        {continueItems.map(({ entry, position }) => {
                            const fraction =
                                position.duration > 0 ? clamp01(position.time / position.duration) : 0;
                            const remaining = Math.max(0, position.duration - position.time);
                            return (
                                <button
                                    key={entry.path}
                                    type="button"
                                    className="mediaPanelContinueCard"
                                    title={`${entry.title}\n${entry.path}`}
                                    onClick={() => onSelectVideo(entry.path)}
                                >
                                    <MediaThumbnail path={entry.path} className="mediaPanelContinueArt" />
                                    <span className="mediaPanelContinueBody">
                                        <span className="mediaPanelContinueTitle">{entry.title}</span>
                                        <span className="mediaPanelContinueMeta">
                                            {remaining > 0
                                                ? `${formatTime(remaining)} left`
                                                : `Resume at ${formatTime(position.time)}`}
                                        </span>
                                        <span className="mediaPanelMiniProgress" aria-hidden>
                                            <span style={{ width: `${Math.round(fraction * 100)}%` }} />
                                        </span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </section>
            ) : null}

            <section className="mediaPanelHomeDropZone" aria-label="Drop videos to add them">
                <FontAwesomeIcon icon={faFolderOpen} aria-hidden />
                <span className="mediaPanelBlankTitle">Drop videos here</span>
                <span className="mediaPanelBlankText">
                    Drag a folder or an MP4/WebM file anywhere in the Media panel.
                </span>
            </section>
        </div>
    );
};

export default MediaHome;
