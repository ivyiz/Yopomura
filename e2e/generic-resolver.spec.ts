import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { _electron as electron, expect, test } from "@playwright/test";

const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let index = 0; index < 256; index += 1) {
        let value = index;
        for (let bit = 0; bit < 8; bit += 1) {
            value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
        }
        table[index] = value >>> 0;
    }
    return table;
})();

const crc32 = (buffer: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (tag: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag, "ascii"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
};

const makePng = (seed: number): Buffer => {
    const width = 320;
    const height = 320;
    const row = Buffer.alloc(width * 3);
    for (let index = 0; index < width; index += 1) {
        row[index * 3] = (seed * 37 + index) % 255;
        row[index * 3 + 1] = (seed * 73 + index) % 255;
        row[index * 3 + 2] = (seed * 109 + index) % 255;
    }
    const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), row])));
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", header),
        pngChunk("IDAT", zlib.deflateSync(raw)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
};

test("generic resolver follows chapters and downloads resolved images", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-resolver-out-"));
    const images = new Map<string, Buffer>();
    for (let index = 1; index <= 8; index += 1) images.set(`/img/${index}.png`, makePng(index));

    const server = http.createServer((request, response) => {
        const url = request.url || "/";
        if (url === "/series") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(
                "<!doctype html><html><head><title>Generic Series | Test</title></head><body>" +
                    "<h1>Generic Series</h1>" +
                    '<a href="/chapter/1">Chapter 1</a>' +
                    '<a href="/chapter/2">Chapter 2</a>' +
                    "</body></html>",
            );
            return;
        }
        if (url === "/chapter/1") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(
                "<!doctype html><html><head><title>Generic Series - Chapter 1</title></head><body>" +
                    '<img data-src="/img/1.png" width="320" height="320">' +
                    '<img data-src="/img/2.png" width="320" height="320">' +
                    '<img data-src="/img/3.png" width="320" height="320">' +
                    '<a href="/chapter/1?page=2">Next page</a>' +
                    "</body></html>",
            );
            return;
        }
        if (url === "/chapter/1?page=2") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(
                "<!doctype html><html><body>" +
                    '<img src="/img/4.png" width="320" height="320">' +
                    '<img src="/img/5.png" width="320" height="320">' +
                    "</body></html>",
            );
            return;
        }
        if (url === "/chapter/2") {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(
                "<!doctype html><html><body>" +
                    '<img src="/img/6.png" width="320" height="320">' +
                    '<img src="/img/7.png" width="320" height="320">' +
                    '<img src="/img/8.png" width="320" height="320">' +
                    "</body></html>",
            );
            return;
        }
        const image = images.get(url);
        if (image) {
            response.writeHead(200, { "Content-Type": "image/png" });
            response.end(image);
            return;
        }
        response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const seriesUrl = `http://127.0.0.1:${port}/series`;

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: {
            ...process.env,
            NODE_ENV: "production",
            YOPOMURA_DOWNLOADER_REVIEW: "0",
            YOPOMURA_RESOLVER_MAX_CHAPTERS: "2",
            YOPOMURA_RESOLVER_MAX_IMAGES: "12",
            YOPOMURA_RESOLVER_MAX_READER_PAGES: "2",
            YOPOMURA_RESOLVER_MAX_MS: "120000",
        },
    });
    const errors: string[] = [];
    try {
        const page = await app.firstWindow();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.waitForSelector(".locationRow", { timeout: 60_000 });

        const preview = await page.evaluate(async (url) => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (
                            channel: string,
                            arg?: unknown,
                        ) => Promise<{
                            ok: boolean;
                            title: string;
                            mode: string;
                            chapters: number;
                            images: number;
                        }>;
                    };
                }
            ).electron;
            return bridge.invoke("downloader:preview", { url });
        }, seriesUrl);
        console.log("PREVIEW", preview);
        expect(preview.ok).toBe(true);
        expect(preview.title).toContain("Generic Series");
        expect(preview.mode).toBe("series");
        expect(preview.chapters).toBe(2);
        expect(preview.images).toBe(8);

        const added = await page.evaluate(
            async ({ url, target }) => {
                const bridge = (
                    window as unknown as {
                        electron: {
                            invoke: (channel: string, arg?: unknown) => Promise<{ id: string }>;
                        };
                    }
                ).electron;
                return bridge.invoke("downloader:add", { url, outDir: target, keepFolder: false });
            },
            { url: seriesUrl, target: outDir },
        );
        expect(added.id).toBeTruthy();

        await expect
            .poll(
                async () =>
                    page.evaluate(async (id) => {
                        const bridge = (
                            window as unknown as {
                                electron: {
                                    invoke: (
                                        channel: string,
                                        arg?: unknown,
                                    ) => Promise<{
                                        jobs: Array<{
                                            id: string;
                                            status: string;
                                            outputPath: string;
                                            error: string;
                                            downloaded: number;
                                        }>;
                                    }>;
                                };
                            }
                        ).electron;
                        const state = await bridge.invoke("downloader:getState");
                        return state.jobs.find((row) => row.id === id)?.status ?? "";
                    }, added.id),
                { timeout: 120_000 },
            )
            .toBe("done");

        const job = await page.evaluate(async (id) => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (
                            channel: string,
                            arg?: unknown,
                        ) => Promise<{
                            jobs: Array<{
                                id: string;
                                status: string;
                                outputPath: string;
                                error: string;
                                downloaded: number;
                            }>;
                        }>;
                    };
                }
            ).electron;
            const state = await bridge.invoke("downloader:getState");
            return state.jobs.find((row) => row.id === id) ?? null;
        }, added.id);
        expect(job).toMatchObject({ status: "done", downloaded: 8 });
        expect(fs.existsSync(job?.outputPath || "")).toBe(true);
        expect(errors).toEqual([]);
        console.log("GENERIC_RESOLVER_OK");
    } finally {
        await app.close();
        server.close();
        fs.rmSync(outDir, { recursive: true, force: true });
    }
});
