import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type {
    AddDownloaderJobInput,
    DownloaderJob,
    DownloaderJobStatus,
    DownloaderPreview,
    DownloaderSource,
    DownloaderState,
} from "@common/types/downloader";
import { getProxyEnvironment } from "@electron/network/proxySettings";
import { createMainLogger } from "@electron/util/logger";
import { app } from "electron";
import { type ResolvedDownloadItem, resolveDownload } from "./browserResolver";
import { recipeStore } from "./recipeStore";
import { recordSource, shouldTryExtractor } from "./sourceCache";

const log = createMainLogger("downloader/service");

const envInt = (name: string, fallback: number): number => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
};

/** How long the legacy extractor may try before the browser resolver takes over. */
const LEGACY_PROBE_MS = envInt("YOPOMURA_LEGACY_PROBE_MS", 8000);

/** Legacy-first is on by default; set YOPOMURA_DOWNLOADER_LEGACY_FIRST=0 to disable. */
const legacyFirstEnabled = (): boolean => {
    const raw = (process.env.YOPOMURA_DOWNLOADER_LEGACY_FIRST || "").trim().toLowerCase();
    return !["0", "false", "no", "off"].includes(raw);
};

const SOURCE_LABEL: Record<DownloaderSource, string> = {
    recipe: "recipe",
    extractor: "site extractor",
    browser: "browser resolver",
    unknown: "resolver",
};

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
        return "";
    }
};

/** Optional private extractor shipped outside the public core. */
const privateExtractorPath = (): string | null => {
    const candidates = [
        process.env.YOPOMURA_DOWNLOADER_EXTRACTOR_PATH,
        app.isPackaged
            ? path.join(process.resourcesPath, "private", "downloader_extractor.py")
            : path.join(app.getAppPath(), "private", "downloader_extractor.py"),
        path.join(app.getPath("userData"), "private", "downloader_extractor.py"),
    ];
    for (const candidate of candidates) {
        if (candidate && fs.existsSync(candidate)) return candidate;
    }
    return null;
};

type WorkerEvent = {
    event: "ready" | "job" | "log" | "probe";
    id?: string;
    status?: DownloaderJobStatus;
    title?: string;
    progress?: number;
    downloaded?: number;
    total?: number;
    outputPath?: string;
    message?: string;
    error?: string;
    level?: "info" | "warn" | "error";
    token?: string;
    ok?: boolean;
    busy?: boolean;
    items?: unknown;
    headers?: unknown;
    elapsedMs?: number;
};

type ProbeResult = {
    ok: boolean;
    busy: boolean;
    title: string;
    items: ResolvedDownloadItem[];
    headers: Record<string, string>;
    error: string;
};

type ResolveOutcome = {
    source: DownloaderSource;
    title: string;
    mode: DownloaderPreview["mode"];
    chapters: number;
    items: ResolvedDownloadItem[];
    headers: Record<string, string>;
    /** True when the legacy extractor was already attempted for this URL. */
    legacyTried: boolean;
    /** Last resolver error, if every fallback failed. */
    error: string;
};

/**
 * Owns the Python downloader sidecar and exposes a small JSON job queue.
 * The renderer only sees {@link DownloaderState}; all process/stdio work stays here.
 */
class DownloaderService extends EventEmitter {
    private worker: ChildProcessWithoutNullStreams | null = null;
    private stdoutBuffer = "";
    private pendingCommands: string[] = [];
    private jobs = new Map<string, DownloaderJob>();
    private activeId: string | null = null;
    private paused = false;
    private starting = false;
    private workerReady = false;
    private readyWaiters: Array<(ready: boolean) => void> = [];
    private resolutionQueue: Array<{ id: string; url: string }> = [];
    private resolutionRunning = false;
    private probes = new Map<string, (result: ProbeResult) => void>();
    private browserRetries = new Set<string>();

    getState(): DownloaderState {
        return {
            ready: Boolean(this.worker),
            activeId: this.activeId,
            paused: this.paused,
            jobs: [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt),
        };
    }

    /** Spawns the sidecar if needed. Safe to call from every panel mount. */
    start(): void {
        this.ensureWorker();
    }

    /** Resolves a URL without queueing it, for the Preview panel and diagnostics. */
    async preview(url: string): Promise<DownloaderPreview> {
        const target = url.trim();
        const empty = (message: string): DownloaderPreview => ({
            ok: false,
            url: target,
            title: "",
            mode: "unknown",
            chapters: 0,
            images: 0,
            sample: [],
            source: "unknown",
            message,
        });
        if (!/^https?:\/\//i.test(target)) return empty("URL must start with http:// or https://");
        try {
            const outcome = await this.resolveTarget(target, true);
            if (outcome.items.length === 0) {
                return empty(outcome.error || "No downloadable images found");
            }
            return {
                ok: true,
                url: target,
                title: outcome.title,
                mode: outcome.mode,
                chapters: outcome.chapters,
                images: outcome.items.length,
                sample: outcome.items.slice(0, 8).map((item) => item.url),
                source: outcome.source,
                message: `Found ${outcome.items.length} image(s) via ${SOURCE_LABEL[outcome.source]}`,
            };
        } catch (error) {
            return empty(error instanceof Error ? error.message : String(error));
        }
    }

    /**
     * Holds the active job and the queue. The worker keeps its stdin loop alive,
     * so a paused download can still be cancelled, resumed or extended.
     */
    pause(): void {
        if (this.paused) return;
        this.paused = true;
        this.send({ cmd: "pause" });
        this.broadcast();
    }

    /** Releases a paused worker; jobs continue with their existing progress. */
    resume(): void {
        if (!this.paused) return;
        this.paused = false;
        this.send({ cmd: "resume" });
        this.broadcast();
    }

    addJob({ url, outDir, keepFolder = false }: AddDownloaderJobInput): DownloaderJob {
        const now = Date.now();
        const job: DownloaderJob = {
            id: randomUUID(),
            url: url.trim(),
            outDir: path.normalize(outDir.trim()),
            keepFolder,
            status: "resolving",
            source: "unknown",
            title: "",
            progress: 0,
            downloaded: 0,
            total: 0,
            outputPath: "",
            message: "Analyzing page",
            error: "",
            createdAt: now,
            updatedAt: now,
        };
        this.jobs.set(job.id, job);
        this.ensureWorker();
        this.broadcast();
        this.resolutionQueue.push({ id: job.id, url: job.url });
        void this.processResolutionQueue();
        return job;
    }

    cancelJob(id: string): void {
        const job = this.jobs.get(id);
        if (!job) return;
        if (job.status === "done" || job.status === "error" || job.status === "cancelled") return;
        this.resolutionQueue = this.resolutionQueue.filter((item) => item.id !== id);
        this.send({ cmd: "cancel", id });
        this.patchJob(id, { status: "cancelled", message: "Cancelled", updatedAt: Date.now() });
    }

    removeJob(id: string): void {
        this.resolutionQueue = this.resolutionQueue.filter((item) => item.id !== id);
        this.browserRetries.delete(id);
        this.jobs.delete(id);
        this.broadcast();
    }

    clearFinished(): void {
        for (const [id, job] of this.jobs) {
            if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
                this.browserRetries.delete(id);
                this.jobs.delete(id);
            }
        }
        this.broadcast();
    }

    shutdown(): void {
        this.send({ cmd: "shutdown" });
        const worker = this.worker;
        this.worker = null;
        this.starting = false;
        this.workerReady = false;
        this.settleReadyWaiters(false);
        this.paused = false;
        if (worker && !worker.killed) {
            setTimeout(() => {
                try {
                    worker.kill();
                } catch {
                    // already gone
                }
            }, 1500).unref();
        }
    }

    private async processResolutionQueue(): Promise<void> {
        if (this.resolutionRunning) return;
        this.resolutionRunning = true;
        try {
            while (true) {
                const next = this.resolutionQueue.shift();
                if (!next) break;
                const job = this.jobs.get(next.id);
                if (!job || job.status === "cancelled") continue;

                const outcome = await this.resolveTarget(next.url, true);
                const current = this.jobs.get(next.id);
                if (!current || current.status === "cancelled") continue;

                if (outcome.items.length === 0) {
                    if (!outcome.legacyTried) {
                        log.warn("browser resolver found no images; trying legacy extractor", {
                            url: next.url,
                        });
                        this.patchJob(next.id, {
                            message: "Trying legacy extractor",
                            updatedAt: Date.now(),
                        });
                        this.send({
                            cmd: "add",
                            id: next.id,
                            url: current.url,
                            outDir: current.outDir,
                            keepFolder: current.keepFolder,
                        });
                    } else {
                        log.warn("no resolver found images", {
                            url: next.url,
                            error: outcome.error,
                        });
                        this.failJob(next.id, outcome.error || "No downloadable images found");
                    }
                    continue;
                }

                this.patchJob(next.id, {
                    title: outcome.title,
                    total: outcome.items.length,
                    source: outcome.source,
                    message: `Resolved with ${SOURCE_LABEL[outcome.source]} (${outcome.items.length} image(s))`,
                    updatedAt: Date.now(),
                });
                log.info("resolved download", {
                    url: next.url,
                    source: outcome.source,
                    mode: outcome.mode,
                    chapters: outcome.chapters,
                    images: outcome.items.length,
                });
                this.send({
                    cmd: "addResolved",
                    id: next.id,
                    url: current.url,
                    outDir: current.outDir,
                    keepFolder: current.keepFolder,
                    title: outcome.title,
                    items: outcome.items,
                    headers: outcome.headers,
                });
            }
        } finally {
            this.resolutionRunning = false;
        }
    }

    /** Recipe -> legacy extractor -> browser resolver. */
    private async resolveTarget(url: string, allowExtractor: boolean): Promise<ResolveOutcome> {
        let hasRecipe = false;
        try {
            hasRecipe = Boolean(recipeStore.match(url));
        } catch (error) {
            log.warn("could not check downloader recipes", error);
        }

        let legacyTried = false;
        if (allowExtractor && !hasRecipe && legacyFirstEnabled() && shouldTryExtractor(url)) {
            legacyTried = true;
            this.ensureWorker();
            const probe = await this.probeLegacy(url);
            if (probe?.busy) {
                log.info("legacy probe busy; using browser resolver", { url });
            } else if (probe && probe.items.length > 0) {
                recordSource(url, "extractor");
                log.info("legacy extractor resolved", {
                    url,
                    images: probe.items.length,
                });
                return {
                    source: "extractor",
                    title: probe.title || hostOf(url) || "download",
                    mode: "gallery",
                    chapters: 0,
                    items: probe.items,
                    headers: probe.headers,
                    legacyTried,
                    error: "",
                };
            } else {
                recordSource(url, "browser");
                log.info("legacy extractor found nothing; using browser resolver", {
                    url,
                    error: probe?.error || "",
                });
            }
        }

        try {
            const resolved = await resolveDownload(url);
            return {
                source: resolved.source,
                title: resolved.title,
                mode: resolved.mode,
                chapters: resolved.chapters,
                items: resolved.items,
                headers: resolved.headers,
                legacyTried,
                error: "",
            };
        } catch (error) {
            return {
                source: "unknown",
                title: "",
                mode: "unknown",
                chapters: 0,
                items: [],
                headers: {},
                legacyTried,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /** Extracts a gallery in the worker without downloading it. */
    private async probeLegacy(url: string): Promise<ProbeResult | null> {
        this.ensureWorker();
        if (!(await this.waitForWorkerReady())) {
            log.warn("legacy probe skipped; worker did not start", { url });
            return null;
        }
        return new Promise((resolve) => {
            const token = randomUUID();
            let timer: NodeJS.Timeout | undefined;
            let settled = false;
            const finish = (result: ProbeResult | null) => {
                if (settled) return;
                settled = true;
                if (timer) clearTimeout(timer);
                this.probes.delete(token);
                resolve(result);
            };
            timer = setTimeout(() => {
                log.warn("legacy probe timed out", { url, timeoutMs: LEGACY_PROBE_MS });
                finish(null);
            }, LEGACY_PROBE_MS);
            this.probes.set(token, (result) => finish(result));
            this.send({ cmd: "probe", url, token });
        });
    }

    /** Resolves true once the worker emitted ready, false on timeout/shutdown. */
    private waitForWorkerReady(timeoutMs = 15000): Promise<boolean> {
        if (this.workerReady) return Promise.resolve(true);
        return new Promise((resolve) => {
            let settled = false;
            const waiter = (ready: boolean) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(ready);
            };
            const timer = setTimeout(() => {
                if (settled) return;
                settled = true;
                this.readyWaiters = this.readyWaiters.filter((item) => item !== waiter);
                resolve(false);
            }, timeoutMs);
            this.readyWaiters.push(waiter);
        });
    }

    private settleReadyWaiters(ready: boolean): void {
        const waiters = this.readyWaiters;
        this.readyWaiters = [];
        for (const waiter of waiters) waiter(ready);
    }

    private failJob(id: string, message: string): void {
        if (this.activeId === id) this.activeId = null;
        this.patchJob(id, {
            status: "error",
            message: "Download failed",
            error: message,
            updatedAt: Date.now(),
        });
    }

    /** One retry when the legacy extractor returned URLs that all failed to download. */
    private async retryWithBrowser(id: string): Promise<void> {
        const job = this.jobs.get(id);
        if (!job || job.status === "cancelled") return;
        try {
            const resolved = await resolveDownload(job.url);
            const current = this.jobs.get(id);
            if (!current || current.status === "cancelled") return;
            if (resolved.items.length === 0) {
                this.failJob(id, "No downloadable images found");
                return;
            }
            this.patchJob(id, {
                status: "resolving",
                source: resolved.source,
                title: resolved.title,
                total: resolved.items.length,
                downloaded: 0,
                progress: 0,
                error: "",
                message: `Retrying with ${SOURCE_LABEL[resolved.source]} (${resolved.items.length} image(s))`,
                updatedAt: Date.now(),
            });
            this.send({
                cmd: "addResolved",
                id,
                url: current.url,
                outDir: current.outDir,
                keepFolder: current.keepFolder,
                title: resolved.title,
                items: resolved.items,
                headers: resolved.headers,
            });
        } catch (error) {
            log.warn("browser retry failed", {
                url: job.url,
                error: error instanceof Error ? error.message : String(error),
            });
            this.failJob(id, error instanceof Error ? error.message : String(error));
        }
    }

    private ensureWorker(): void {
        if (this.worker || this.starting) return;
        this.starting = true;
        const command = this.workerCommand();
        if (!command) {
            this.starting = false;
            this.emit("error-state", "Downloader worker was not found.");
            return;
        }
        try {
            const extractorPath = privateExtractorPath();
            const worker = spawn(command.file, command.args, {
                cwd: command.cwd,
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
                env: {
                    ...process.env,
                    ...getProxyEnvironment(),
                    ...(extractorPath ? { YOPOMURA_DOWNLOADER_EXTRACTOR_PATH: extractorPath } : {}),
                    PYTHONIOENCODING: "utf-8",
                    PYTHONUNBUFFERED: "1",
                },
            }) as ChildProcessWithoutNullStreams;
            this.worker = worker;
            this.workerReady = false;
            worker.stdout.setEncoding("utf8");
            worker.stdout.on("data", (chunk: string) => this.onStdout(chunk));
            worker.stderr.setEncoding("utf8");
            worker.stderr.on("data", (chunk: string) => log.warn(`worker stderr: ${chunk.trim()}`));
            worker.once("error", (err) => {
                log.error("worker failed to start", err);
                this.worker = null;
                this.starting = false;
                this.workerReady = false;
                this.settleReadyWaiters(false);
                this.paused = false;
                this.emit("error-state", err.message);
            });
            worker.once("exit", (code, signal) => {
                log.info("worker exited", { code, signal });
                this.worker = null;
                this.starting = false;
                this.workerReady = false;
                this.settleReadyWaiters(false);
                this.paused = false;
                if (this.activeId) {
                    this.patchJob(this.activeId, {
                        status: "error",
                        error: `Downloader worker stopped (${code ?? signal ?? "unknown"}).`,
                        updatedAt: Date.now(),
                    });
                    this.activeId = null;
                }
                this.broadcast();
            });
        } catch (err) {
            this.starting = false;
            this.workerReady = false;
            this.settleReadyWaiters(false);
            log.error("worker spawn threw", err);
            this.emit("error-state", err instanceof Error ? err.message : String(err));
        }
    }

    /** Packaged: resources/downloader/MangaDownloaderWorker.exe; dev: python downloader/worker.py. */
    private workerCommand(): { file: string; args: string[]; cwd: string } | null {
        const packaged = path.join(process.resourcesPath, "downloader", "MangaDownloaderWorker.exe");
        if (app.isPackaged) {
            if (!fs.existsSync(packaged)) {
                log.error("packaged downloader worker missing", { packaged });
                return null;
            }
            return { file: packaged, args: [], cwd: path.dirname(packaged) };
        }
        const repoRoot = app.getAppPath();
        const script = path.join(repoRoot, "downloader", "worker.py");
        if (!fs.existsSync(script)) {
            log.error("dev downloader worker missing", { script });
            return null;
        }
        const python = process.env.YOKO_PYTHON || "python";
        return { file: python, args: [script], cwd: repoRoot };
    }

    private send(command: Record<string, unknown>): void {
        const line = JSON.stringify(command);
        const worker = this.worker;
        if (!worker || !worker.stdin.writable) {
            this.pendingCommands.push(line);
            return;
        }
        worker.stdin.write(`${line}\n`);
    }

    private onStdout(chunk: string): void {
        this.stdoutBuffer += chunk;
        let index = this.stdoutBuffer.indexOf("\n");
        while (index >= 0) {
            const line = this.stdoutBuffer.slice(0, index).trim();
            this.stdoutBuffer = this.stdoutBuffer.slice(index + 1);
            if (line) this.handleWorkerLine(line);
            index = this.stdoutBuffer.indexOf("\n");
        }
    }

    private handleWorkerLine(line: string): void {
        let event: WorkerEvent;
        try {
            event = JSON.parse(line) as WorkerEvent;
        } catch {
            log.warn("worker emitted non-JSON line", { line });
            return;
        }
        if (event.event === "ready") {
            this.starting = false;
            this.workerReady = true;
            this.settleReadyWaiters(true);
            const queued = this.pendingCommands;
            this.pendingCommands = [];
            for (const command of queued) this.send(JSON.parse(command) as Record<string, unknown>);
            // Pause survives a (re)spawn: the fresh worker starts unpaused.
            if (this.paused) this.send({ cmd: "pause" });
            this.broadcast();
            return;
        }
        if (event.event === "log") {
            log.info(`[downloader] ${event.message ?? ""}`);
            return;
        }
        if (event.event === "probe") {
            if (!event.token) return;
            const settle = this.probes.get(event.token);
            if (!settle) return;
            const items: ResolvedDownloadItem[] = [];
            if (Array.isArray(event.items)) {
                for (const row of event.items) {
                    if (!row || typeof row !== "object") continue;
                    const url = (row as { url?: unknown }).url;
                    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
                    const referer = (row as { referer?: unknown }).referer;
                    items.push({
                        url,
                        referer: typeof referer === "string" && referer ? referer : undefined,
                    });
                }
            }
            const headers: Record<string, string> = {};
            if (event.headers && typeof event.headers === "object") {
                for (const [key, value] of Object.entries(event.headers)) {
                    if (typeof value === "string") headers[key] = value;
                }
            }
            settle({
                ok: Boolean(event.ok) && items.length > 0,
                busy: Boolean(event.busy),
                title: typeof event.title === "string" ? event.title : "",
                items,
                headers,
                error: typeof event.error === "string" ? event.error : "",
            });
            return;
        }
        if (event.event !== "job" || !event.id) return;
        const job = this.jobs.get(event.id);
        if (!job) return;
        const downloaded = event.downloaded ?? job.downloaded;
        if (
            event.status === "error" &&
            job.source === "extractor" &&
            downloaded === 0 &&
            !this.browserRetries.has(event.id)
        ) {
            this.browserRetries.add(event.id);
            if (this.activeId === event.id) this.activeId = null;
            this.patchJob(event.id, {
                status: "resolving",
                message: "Site extractor failed; retrying with browser resolver",
                error: "",
                downloaded: 0,
                progress: 0,
                total: 0,
                updatedAt: Date.now(),
            });
            void this.retryWithBrowser(event.id);
            return;
        }
        const next: Partial<DownloaderJob> = {
            updatedAt: Date.now(),
        };
        if (event.status) next.status = event.status;
        if (event.title !== undefined) next.title = event.title;
        if (event.progress !== undefined) next.progress = event.progress;
        if (event.downloaded !== undefined) next.downloaded = event.downloaded;
        if (event.total !== undefined) next.total = event.total;
        if (event.outputPath !== undefined) next.outputPath = event.outputPath;
        if (event.message !== undefined) next.message = event.message;
        if (event.error !== undefined) next.error = event.error;

        if (
            event.status === "resolving" ||
            event.status === "downloading" ||
            event.status === "paused" ||
            event.status === "packing"
        ) {
            this.activeId = event.id;
        }
        if (event.status === "done" || event.status === "error" || event.status === "cancelled") {
            if (this.activeId === event.id) this.activeId = null;
        }
        this.patchJob(event.id, next);
    }

    private patchJob(id: string, patch: Partial<DownloaderJob>): void {
        const job = this.jobs.get(id);
        if (!job) return;
        const next = { ...job, ...patch };
        this.jobs.set(id, next);
        if (next.status === "done" && job.status !== "done") {
            this.emit("job-done", next);
        }
        this.broadcast();
    }

    private broadcast(): void {
        this.emit("state", this.getState());
    }
}

export const downloaderService = new DownloaderService();
