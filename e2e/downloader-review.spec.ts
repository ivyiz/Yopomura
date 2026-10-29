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
    const width = 400;
    const height = 400;
    const row = Buffer.alloc(width * 3);
    for (let index = 0; index < width; index += 1) {
        row[index * 3] = (seed * 31 + index) % 255;
        row[index * 3 + 1] = (seed * 67 + index) % 255;
        row[index * 3 + 2] = (seed * 97 + index) % 255;
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

test("review modal starts with every image selected and downloads only the selection", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-review-out-"));
    const images = new Map<string, Buffer>();
    for (let index = 1; index <= 3; index += 1) images.set(`/img/${index}.png`, makePng(index));

    const server = http.createServer((request, response) => {
        const url = request.url || "/";
        const image = images.get(url);
        if (image) {
            response.writeHead(200, { "Content-Type": "image/png" });
            response.end(image);
            return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
            '<!doctype html><html><body><div class="reader">' +
                '<img src="/img/1.png" width="400" height="400">' +
                '<img src="/img/2.png" width="400" height="400">' +
                '<img src="/img/3.png" width="400" height="400">' +
                "</div></body></html>",
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const url = `http://127.0.0.1:${port}/gallery`;

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: {
            ...process.env,
            NODE_ENV: "production",
            YOPOMURA_RESOLVER_MAX_CHAPTERS: "2",
            YOPOMURA_RESOLVER_MAX_IMAGES: "10",
            YOPOMURA_RESOLVER_MAX_READER_PAGES: "2",
            YOPOMURA_RESOLVER_MAX_MS: "60000",
        },
    });

    try {
        const page = await app.firstWindow();
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.waitForSelector(".locationRow", { timeout: 60_000 });

        const added = await page.evaluate(
            async ({ url: target, outDir: targetDir }) => {
                const bridge = (
                    window as unknown as {
                        electron: {
                            invoke: (channel: string, arg?: unknown) => Promise<{ id: string }>;
                        };
                    }
                ).electron;
                return bridge.invoke("downloader:add", { url: target, outDir: targetDir });
            },
            { url, outDir },
        );

        await expect(page.locator(".downloaderReviewOverlay")).toBeVisible({ timeout: 90_000 });
        const rows = page.locator(".downloaderReviewItem");
        await expect(rows).toHaveCount(3);
        await expect(page.locator(".downloaderReviewItem input:checked")).toHaveCount(3);
        await expect(page.locator(".downloaderReviewCount")).toContainText("3 / 3 selected");

        const review = await page.evaluate(async (id) => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (
                            channel: string,
                            arg?: unknown,
                        ) => Promise<{ items: Array<{ url: string }> } | null>;
                    };
                }
            ).electron;
            return bridge.invoke("downloader:getReview", { id });
        }, added.id);
        expect(review?.items).toHaveLength(3);

        await rows.first().locator("input").uncheck();
        await expect(page.locator(".downloaderReviewCount")).toContainText("2 / 3 selected");
        await page.locator(".downloaderReviewConfirm").click();

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
                                            downloaded: number;
                                        }>;
                                    }>;
                                };
                            }
                        ).electron;
                        const state = await bridge.invoke("downloader:getState");
                        const job = state.jobs.find((row) => row.id === id);
                        return job ? `${job.status}:${job.downloaded}` : "";
                    }, added.id),
                { timeout: 120_000 },
            )
            .toBe("done:2");

        await expect(page.locator(".downloaderReviewOverlay")).toHaveCount(0);
        expect(errors).toEqual([]);
        console.log("DOWNLOADER_REVIEW_OK");
    } finally {
        await app.close();
        server.close();
        fs.rmSync(outDir, { recursive: true, force: true });
    }
});
