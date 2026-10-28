import { formatBytes } from "@features/media/mediaLibrary";
import type { DownloadFeedRow, DownloadFeedStatus } from "./downloadFeed";

export type DownloadFileKind = "video" | "archive" | "image" | "document" | "executable" | "other";

const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mkv", "mov", "avi", "m4v", "ts"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "cbz", "cbr", "tar", "gz", "bz2", "xz"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "gif", "webp", "avif", "bmp", "svg"]);
const DOCUMENT_EXTENSIONS = new Set([
    "pdf",
    "epub",
    "txt",
    "md",
    "doc",
    "docx",
    "html",
    "htm",
    "json",
    "csv",
    "xml",
]);
const EXECUTABLE_EXTENSIONS = new Set(["exe", "msi", "bat", "cmd", "apk", "dmg", "appimage"]);

/** Classifies a file path/title for the download bubble icon. */
export const downloadFileKind = (value: string): DownloadFileKind => {
    const clean = value.split(/[?#]/)[0]?.toLowerCase() ?? "";
    const extension = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1) : "";
    if (VIDEO_EXTENSIONS.has(extension)) return "video";
    if (ARCHIVE_EXTENSIONS.has(extension)) return "archive";
    if (IMAGE_EXTENSIONS.has(extension)) return "image";
    if (DOCUMENT_EXTENSIONS.has(extension)) return "document";
    if (EXECUTABLE_EXTENSIONS.has(extension)) return "executable";
    return "other";
};

export const DOWNLOAD_STATUS_LABEL: Record<DownloadFeedStatus, string> = {
    progressing: "Downloading…",
    done: "Done",
    error: "Failed",
    cancelled: "Cancelled",
    interrupted: "Interrupted",
};

/** Percent for a row, or null while the server has not sent Content-Length. */
export const downloadProgressPercent = (row: DownloadFeedRow): number | null => {
    if (row.status !== "progressing" || row.total <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((row.received / row.total) * 100)));
};

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000_000],
    ["month", 2_592_000_000],
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
];

const relativeFormatter = new Intl.RelativeTimeFormat("en", { numeric: "always" });

/** Chrome-style age label such as "1 hour ago" or "7 hours ago". */
export const formatDownloadAge = (finishedAt: number, now: number = Date.now()): string => {
    const elapsed = Math.max(0, now - finishedAt);
    for (const [unit, milliseconds] of RELATIVE_UNITS) {
        if (elapsed >= milliseconds) {
            return relativeFormatter.format(-Math.floor(elapsed / milliseconds), unit);
        }
    }
    return "Just now";
};

/** Chrome-style meta line: "147 KB · 1 hour ago" or "2.3/5.1 MB · 45%". */
export const formatDownloadMeta = (row: DownloadFeedRow, now: number = Date.now()): string => {
    if (row.status === "progressing") {
        const percent = downloadProgressPercent(row);
        if (percent !== null) {
            return `${formatBytes(row.received)}/${formatBytes(row.total)} · ${percent}%`;
        }
        return `${formatBytes(row.received)} · ${DOWNLOAD_STATUS_LABEL.progressing}`;
    }

    const size = formatBytes(row.received);
    const status = row.status === "done" ? "" : ` · ${DOWNLOAD_STATUS_LABEL[row.status]}`;
    const when = row.finishedAt ? ` · ${formatDownloadAge(row.finishedAt, now)}` : "";
    return `${size}${status}${when}`;
};
