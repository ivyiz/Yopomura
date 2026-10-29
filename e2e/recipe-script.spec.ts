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

test("script recipe resolves dynamically built pages and downloads", async () => {
    test.setTimeout(300_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const recipeDir = path.join(appDir, "userdata", "downloader-recipes");
    const recipePath = path.join(recipeDir, "local-script-recipe.json");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-script-out-"));
    const images = new Map<string, Buffer>();
    for (let index = 1; index <= 3; index += 1) images.set(`/img/${index}.png`, makePng(index));

    const script = [
        "async ({ url }) => {",
        "    const chapters = window.__chapters || [];",
        "    const images = window.__imgs || [];",
        "    return {",
        "        title: document.title,",
        "        chapters: chapters.map((row) => ({ href: new URL(row.href, url).href, name: row.name })),",
        "        images: images.map((image) => new URL(image, url).href),",
        "        next: '',",
        "    };",
        "}",
    ].join("\n");

    fs.mkdirSync(recipeDir, { recursive: true });
    fs.writeFileSync(
        recipePath,
        JSON.stringify(
            {
                id: "local-script-recipe",
                name: "Local Script Recipe",
                match: ["127.0.0.1"],
                mode: "series",
                script,
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
        if (url === "/script/series") {
            html(
                "<script>window.__chapters = [{ href: '/script/ch1', name: 'Chapter 1' }," +
                    "{ href: '/script/ch2', name: 'Chapter 2' }];</script><div id=\"app\"></div>",
            );
            return;
        }
        if (url === "/script/ch1") {
            html("<script>window.__imgs = ['/img/1.png', '/img/2.png'];</script><div class=\"reader\"></div>");
            return;
        }
        if (url === "/script/ch2") {
            html("<script>window.__imgs = ['/img/3.png'];</script><div class=\"reader\"></div>");
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
    const seriesUrl = `http://127.0.0.1:${port}/script/series`;

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
        await expect(page.locator(".downloaderRecipeRow", { hasText: "Local Script Recipe" })).toHaveCount(1);

        await page.locator(".downloaderPreviewBox input").fill(seriesUrl);
        await page.locator(".downloaderPreviewBox button", { hasText: "Preview" }).click();
        await expect(page.locator(".downloaderPreviewResult")).toContainText("series", { timeout: 90_000 });
        await expect(page.locator(".downloaderPreviewResult")).toContainText("3 images", { timeout: 90_000 });

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
            .toBe("done:3");

        await page.locator(".downloaderSitesToolbar button", { hasText: "New Recipe" }).click();
        await expect(page.locator(".downloaderRecipeEditorWarning")).toContainText("Only use recipes you trust");
        await expect(page.locator(".downloaderRecipeEditorGrid textarea")).toBeVisible();
        expect(errors).toEqual([]);
        console.log("RECIPE_SCRIPT_OK");
    } finally {
        await app.close();
        server.close();
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(recipePath, { force: true });
    }
});
