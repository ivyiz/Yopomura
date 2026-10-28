/** Job lifecycle for the Python downloader sidecar. */
export type DownloaderJobStatus =
    | "queued"
    | "resolving"
    | "downloading"
    /** Active job held by a worker-wide pause; not terminal. */
    | "paused"
    | "packing"
    | "done"
    | "error"
    | "cancelled";

export type DownloaderJob = {
    id: string;
    url: string;
    outDir: string;
    keepFolder: boolean;
    status: DownloaderJobStatus;
    title: string;
    progress: number;
    downloaded: number;
    total: number;
    outputPath: string;
    message: string;
    error: string;
    createdAt: number;
    updatedAt: number;
};

export type DownloaderState = {
    /** True once the worker process has emitted its ready event. */
    ready: boolean;
    /** Job currently owned by the worker, or null. */
    activeId: string | null;
    /** True while the worker holds downloads and its queue. */
    paused: boolean;
    jobs: DownloaderJob[];
};

export type AddDownloaderJobInput = {
    url: string;
    outDir: string;
    keepFolder?: boolean;
};

/** Dry-run result from the generic Chromium resolver. */
export type DownloaderPreview = {
    ok: boolean;
    url: string;
    title: string;
    mode: "image" | "gallery" | "reader" | "series" | "unknown";
    chapters: number;
    images: number;
    sample: string[];
    message: string;
};
