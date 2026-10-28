import type { LibraryItem } from "@common/types/db";
import { formatUtils } from "@utils/file";
import { absolutePathToFileUrl, canonicalCoverAbsolutePath, libraryCoverSrc } from "@utils/libraryCover";
import { createRendererLogger } from "@utils/logger";

const log = createRendererLogger("utils/locationCover");

/** Library row fields needed to resolve a location row cover. */
export type LocationCoverItem = Pick<LibraryItem, "id" | "type" | "link" | "cover" | "extra" | "favouritedAt">;

/** Session cache of path-keyed preview promises, stamped with mtime so replaced files refresh. */
const previewByLink = new Map<string, Promise<string>>();

/** Failed library-slot builds for a path version, so scrolling cannot retry an unsupported archive. */
const failedLibraryAttempts = new Set<string>();

/** Normalized key used to match browse paths against catalogue links on Windows. */
export const locationLinkKey = (link: string): string => {
    const normalized = window.path.normalize(link);
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

/**
 * Maps catalogue rows by their normalized link so a Locations row can find its
 * library item (and the thumbnail generated for it) without a per-row DB query.
 */
export const indexLibraryItemsByLink = (
    items: Record<string, LocationCoverItem | null>,
): Map<string, LocationCoverItem> => {
    const index = new Map<string, LocationCoverItem>();
    for (const item of Object.values(items)) {
        if (!item) continue;
        index.set(locationLinkKey(item.link), item);
    }
    return index;
};

/** Writes/reuses the path-keyed preview so browsing outside the catalogue still gets covers. */
const previewCoverSrc = (link: string, stamp: number): Promise<string> => {
    const key = `${locationLinkKey(link)}|${stamp}`;
    const cached = previewByLink.get(key);
    if (cached) return cached;

    const work = window.electron
        .invoke("covers:previewForPath", { path: link })
        .then((result) => (result.ok ? absolutePathToFileUrl(result.filePath) : ""))
        .catch((error) => {
            log.warn("preview cover failed", { link }, error);
            return "";
        });
    previewByLink.set(key, work);
    return work;
};

/**
 * Cover URL for one Locations row.
 *
 * Order: existing managed thumbnail → materialize the library slot for this
 * catalogue row → path-keyed preview (archives/folders not in the catalogue).
 * PDFs return empty here; the row kicks off the renderer PDF render instead.
 *
 * @param dateModified filesystem mtime used as the preview cache stamp
 */
export const resolveLocationCoverSrc = async (
    link: string,
    item: LocationCoverItem | null | undefined,
    dateModified: number,
): Promise<string> => {
    if (item?.id != null) {
        const existing = libraryCoverSrc(item);
        if (existing) return existing;
        if (item.type === "manga" && formatUtils.pdf.test(item.link)) return "";

        const attemptKey = `${item.id}|${dateModified}`;
        if (!failedLibraryAttempts.has(attemptKey)) {
            const result = await window.electron.invoke("covers:materializeFromLibraryPath", {
                libraryId: item.id,
                itemType: item.type,
                link: item.link,
            });
            if (result.ok) {
                const canonical = canonicalCoverAbsolutePath(item.id);
                if (window.fs.isFile(canonical)) return absolutePathToFileUrl(canonical);
            } else {
                failedLibraryAttempts.add(attemptKey);
                log.warn("library cover materialize failed", {
                    link: item.link,
                    message: result.message,
                });
            }
        }
    }

    if (!window.fs.isFile(link)) return "";
    return previewCoverSrc(link, dateModified);
};
