import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type {
    AddDownloaderJobInput,
    DownloaderJob,
    DownloaderJobStatus,
    DownloaderState,
} from "@common/types/downloader";
import { getProxyEnvironment } from "@electron/network/proxySettings";
import { createMainLogger } from "@electron/util/logger";
import { app } from "electron";

const log = createMainLogger("downloader/service");

type WorkerEvent = {
    event: "ready" | "job" | "log";
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
            status: "queued",
            title: "",
            progress: 0,
            downloaded: 0,
            total: 0,
            outputPath: "",
            message: "",
            error: "",
            createdAt: now,
            updatedAt: now,
        };
        this.jobs.set(job.id, job);
        this.ensureWorker();
        this.send({
            cmd: "add",
            id: job.id,
            url: job.url,
            outDir: job.outDir,
            keepFolder: job.keepFolder,
        });
        this.broadcast();
        return job;
    }

    cancelJob(id: string): void {
        const job = this.jobs.get(id);
        if (!job) return;
        if (job.status === "done" || job.status === "error" || job.status === "cancelled") return;
        this.send({ cmd: "cancel", id });
        this.patchJob(id, { status: "cancelled", message: "Cancelled", updatedAt: Date.now() });
    }

    removeJob(id: string): void {
        this.jobs.delete(id);
        this.broadcast();
    }

    clearFinished(): void {
        for (const [id, job] of this.jobs) {
            if (job.status === "done" || job.status === "error" || job.status === "cancelled") {
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
            const worker = spawn(command.file, command.args, {
                cwd: command.cwd,
                windowsHide: true,
                stdio: ["pipe", "pipe", "pipe"],
                env: {
                    ...process.env,
                    ...getProxyEnvironment(),
                    PYTHONIOENCODING: "utf-8",
                    PYTHONUNBUFFERED: "1",
                },
            }) as ChildProcessWithoutNullStreams;
            this.worker = worker;
            worker.stdout.setEncoding("utf8");
            worker.stdout.on("data", (chunk: string) => this.onStdout(chunk));
            worker.stderr.setEncoding("utf8");
            worker.stderr.on("data", (chunk: string) => log.warn(`worker stderr: ${chunk.trim()}`));
            worker.once("error", (err) => {
                log.error("worker failed to start", err);
                this.worker = null;
                this.starting = false;
                this.paused = false;
                this.emit("error-state", err.message);
            });
            worker.once("exit", (code, signal) => {
                log.info("worker exited", { code, signal });
                this.worker = null;
                this.starting = false;
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
        if (event.event !== "job" || !event.id) return;
        const job = this.jobs.get(event.id);
        if (!job) return;
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
