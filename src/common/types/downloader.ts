/** Job lifecycle for the Python downloader sidecar. */
export type DownloaderJobStatus =
    | "queued"
    | "resolving"
    | "downloading"
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
    jobs: DownloaderJob[];
};

export type AddDownloaderJobInput = {
    url: string;
    outDir: string;
    keepFolder?: boolean;
};
