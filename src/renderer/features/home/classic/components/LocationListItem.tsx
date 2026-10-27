import { getDefaultLocationPath } from "@common/library/folders";
import { faFolder } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import ListItem from "@renderer/components/ListItem";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import dateUtils from "@utils/date";
import { dialogUtils } from "@utils/dialog";
import { formatUtils } from "@utils/file";
import { libraryCoverSrc } from "@utils/libraryCover";
import { ensurePdfLibraryCover } from "@utils/libraryCoverService";
import { type LocationCoverItem, resolveLocationCoverSrc } from "@utils/locationCover";
import { type CSSProperties, forwardRef, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppContext } from "src/renderer/App";

/**
 * Card padding (top+bottom) for the cover-style Locations list.
 * Keep in sync with `.locationCoverList .locationRow` in `_listCont.scss`.
 */
export const LOCATION_ROW_PADDING_PX = 16;

/** Vertical gap (px) between cover-style location cards. */
export const LOCATION_ROW_GAP_PX = 10;

/** Default cover width when no app setting is available. */
export const LOCATION_COVER_WIDTH_PX = 80;

/**
 * Virtual row height for a given cover width. The cover is 2:3, so height is 1.5x;
 * a minimum accounts for a large title with a small cover.
 */
export const locationRowHeight = (coverWidth: number, titleFontSizeRem: number): number => {
    const coverHeight = Math.round(coverWidth * 1.5);
    const titleBlock = titleFontSizeRem * 16 * 1.32 * 2 + 0.8 * 16 * 1.3 + 8;
    return Math.max(coverHeight + LOCATION_ROW_PADDING_PX, Math.round(titleBlock) + LOCATION_ROW_PADDING_PX);
};

/** Date style for the "downloaded" timestamp on each row. */
const DOWNLOADED_DATE_FORMAT = "MMM d, yyyy, h:mm a";

type LocationListItemProps = {
    name: string;
    link: string;
    /** Filesystem mtime, shown as the download time. */
    dateModified: number;
    /** Matching catalogue row, when this path has already been scanned. */
    libraryItem?: LocationCoverItem | null;
    setCurrentLink: React.Dispatch<React.SetStateAction<string>>;
    inHistory: boolean;
    onContextMenu: (e: React.MouseEvent<HTMLAnchorElement, MouseEvent>, link: string, inHistory: boolean) => void;
    focused: boolean;
    /** Virtualizer absolute layout (injected by {@link ListNavigator.VirtualList}). */
    style?: CSSProperties;
    "data-index"?: number;
    scrollManagedByParent?: boolean;
};

/**
 * Locations tab row with cover art, title, and download time.
 * Covers are materialized lazily when the virtualizer mounts the row.
 */
const LocationListItem = forwardRef<HTMLLIElement, LocationListItemProps>(
    (
        {
            name,
            link,
            dateModified,
            libraryItem,
            inHistory,
            setCurrentLink,
            onContextMenu,
            focused,
            style,
            "data-index": dataIndex,
            scrollManagedByParent,
        },
        forwardedRef,
    ) => {
        const { t } = useTranslation("home");
        const { openInReader } = useAppContext();
        const dispatch = useAppDispatch();
        const appSettings = useAppSelector((store) => store.appSettings);
        const defaultLocationPath = getDefaultLocationPath(
            useAppSelector((store) => store.mainSettings.library.folders),
        );

        const isFile = formatUtils.files.test(name);
        const title = formatUtils.files.getName(name);
        const dateLabel = dateUtils.format(dateModified, {
            format: DOWNLOADED_DATE_FORMAT,
            fallback: "",
        });
        const canHaveCover = isFile || Boolean(libraryItem);

        const [coverSrc, setCoverSrc] = useState(() => (libraryItem ? libraryCoverSrc(libraryItem) : ""));

        useEffect(() => {
            if (!canHaveCover) {
                setCoverSrc("");
                return;
            }
            let cancelled = false;
            void resolveLocationCoverSrc(link, libraryItem, dateModified).then((src) => {
                if (cancelled) return;
                setCoverSrc(src);
                if (
                    !src &&
                    isFile &&
                    libraryItem?.id != null &&
                    libraryItem.type === "manga" &&
                    formatUtils.pdf.test(link)
                ) {
                    void ensurePdfLibraryCover(dispatch, libraryItem);
                }
            });
            return () => {
                cancelled = true;
            };
        }, [canHaveCover, dateModified, dispatch, isFile, libraryItem, link]);

        const onClickHandle = () => {
            if (!window.fs.existsSync(link)) {
                dialogUtils.customError({ message: t("classic.location.pathMissing") });
                return;
            }
            if (isFile) {
                openInReader(link);
                return;
            }
            if (
                appSettings.openDirectlyFromManga &&
                window.path.normalize(window.path.resolve(`${link}../../../`) + window.path.sep) ===
                    window.path.normalize(defaultLocationPath + window.path.sep)
            ) {
                openInReader(link).then((isValid) => {
                    if (isValid) {
                        setCurrentLink(window.path.dirname(link));
                    }
                });
            }
            setCurrentLink(link);
        };

        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
            if (appSettings.openOnDblClick) {
                const elem = e.currentTarget;
                if (!elem.getAttribute("data-dblClick")) {
                    elem.setAttribute("data-dblClick", "true");
                    setTimeout(() => {
                        if (elem.getAttribute("data-dblClick") === "true") {
                            elem.removeAttribute("data-dblClick");
                            onClickHandle();
                        }
                    }, 250);
                } else {
                    elem.removeAttribute("data-dblClick");
                    openInReader(link);
                }
            } else onClickHandle();
        };

        const handleContextMenu = (e: React.MouseEvent<HTMLAnchorElement>) => {
            onContextMenu(e, link, inHistory);
        };

        return (
            <ListItem
                ref={forwardedRef}
                focused={focused}
                scrollManagedByParent={scrollManagedByParent}
                classNameLi={`locationRow ${isFile ? "locationFile" : "locationFolder"} ${
                    inHistory ? "alreadyRead" : ""
                }`}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                title={name}
                style={style}
                data-index={dataIndex}
            >
                <span className="locationCover" aria-hidden="true">
                    {coverSrc ? (
                        <img
                            src={coverSrc}
                            alt=""
                            draggable={false}
                            loading="lazy"
                            onError={() => setCoverSrc("")}
                        />
                    ) : isFile ? (
                        <span className="locationCoverLetter">{title.trim().charAt(0).toUpperCase()}</span>
                    ) : (
                        <FontAwesomeIcon icon={faFolder} />
                    )}
                </span>
                <span className="locationInfo">
                    <span className="locationTitle text">{title}</span>
                    {dateLabel && (
                        <time
                            className="locationDate"
                            dateTime={new Date(dateModified).toISOString()}
                            title={t("classic.location.downloadedAt", { date: dateLabel })}
                        >
                            {dateLabel}
                        </time>
                    )}
                </span>
            </ListItem>
        );
    },
);
LocationListItem.displayName = "LocationListItem";

export default LocationListItem;
