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

test("declarative recipe loads, previews and downloads", async () => {
    test.setTimeout(300_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const recipeDir = path.join(appDir, "userdata", "downloader-recipes");
    const recipePath = path.join(recipeDir, "local-recipe.json");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-recipe-out-"));
    const images = new Map<string, Buffer>();
    for (let index = 1; index <= 7; index += 1) images.set(`/img/${index}.png`, makePng(index));
    fs.mkdirSync(recipeDir, { recursive: true });
    fs.writeFileSync(
        recipePath,
        JSON.stringify(
            {
                id: "local-recipe",
                name: "Local Recipe",
                match: ["127.0.0.1"],
                mode: "series",
                title: { selector: ".series-title", attribute: "text" },
                chapters: { selector: ".chapter-list a" },
                pages: { selector: ".reader img", attributes: ["data-src", "src"] },
                next: { selector: "a.next-page" },
            },
            null,
            2,
        ),
        "utf8",
    );

    const server = http.createServer((request, response) => {
        const url = request.url || "/";
        const html = (body: string) => {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(`<!doctype html><html><body>${body}</body></html>`);
        };
        if (url === "/recipe/series") {
            html(
                '<h1 class="series-title">Recipe Series</h1><div class="chapter-list">' +
                    '<a href="/recipe/ch1">Chapter 1</a><a href="/recipe/ch2">Chapter 2</a></div>',
            );
            return;
        }
        if (url === "/recipe/ch1") {
            html(
                '<div class="reader"><img data-src="/img/1.png" width="320" height="320">' +
                    '<img data-src="/img/2.png" width="320" height="320">' +
                    '<img data-src="/img/3.png" width="320" height="320"></div>' +
                    '<a class="next-page" href="/recipe/ch1?page=2">Next page</a>',
            );
            return;
        }
        if (url === "/recipe/ch1?page=2") {
            html(
                '<div class="reader"><img src="/img/4.png" width="320" height="320">' +
                    '<img src="/img/5.png" width="320" height="320"></div>',
            );
            return;
        }
        if (url === "/recipe/ch2") {
            html(
                '<div class="reader"><img src="/img/6.png" width="320" height="320">' +
                    '<img src="/img/7.png" width="320" height="320"></div>',
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
    const seriesUrl = `http://127.0.0.1:${port}/recipe/series`;

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: {
            ...process.env,
            NODE_ENV: "production",
            YOPOMURA_RESOLVER_MAX_CHAPTERS: "2",
            YOPOMURA_RESOLVER_MAX_IMAGES: "10",
            YOPOMURA_RESOLVER_MAX_READER_PAGES: "2",
            YOPOMURA_RESOLVER_MAX_MS: "90000",
        },
    });
    const errors: string[] = [];
    try {
        const page = await app.firstWindow();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.waitForSelector(".locationRow", { timeout: 60_000 });

        await page.locator(".downloaderToggle").click();
        await page.waitForSelector(".downloaderPanel", { timeout: 15_000 });
        await page.locator(".downloaderSitesBtn").click();
        await expect(page.locator(".downloaderRecipeRow", { hasText: "Local Recipe" })).toHaveCount(1);

        await page.locator(".downloaderPreviewBox input").fill(seriesUrl);
        await page.locator(".downloaderPreviewBox button", { hasText: "Preview" }).click();
        await expect(page.locator(".downloaderPreviewResult")).toContainText("series", { timeout: 30_000 });
        await expect(page.locator(".downloaderPreviewResult")).toContainText("7 images", { timeout: 30_000 });

        const added = await page.evaluate(
            async ({ url, target }) => {
                const bridge = (
                    window as unknown as {
                        electron: { invoke: (channel: string, arg?: unknown) => Promise<{ id: string }> };
                    }
                ).electron;
                return bridge.invoke("downloader:add", { url, outDir: target, keepFolder: false });
            },
            { url: seriesUrl, target: outDir },
        );
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
                                            outputPath: string;
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
            .toBe("done:7");
        expect(errors).toEqual([]);
        console.log("RECIPE_DOWNLOAD_OK");
    } finally {
        await app.close();
        server.close();
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(recipePath, { force: true });
    }
});
