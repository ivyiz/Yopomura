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

const images = new Map<string, Buffer>();
for (let index = 1; index <= 4; index += 1) images.set(`/img/${index}.png`, makePng(index));

const startFixture = async (): Promise<{ server: http.Server; base: string }> => {
    const server = http.createServer((request, response) => {
        const url = request.url || "/";
        const image = images.get(url);
        if (image) {
            response.writeHead(200, { "Content-Type": "image/png" });
            response.end(image);
            return;
        }
        if (url === "/missing.png") {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
            "<!doctype html><html><head><title>Legacy Fixture</title></head><body>" +
                '<div class="reader">' +
                '<img src="/img/1.png" width="400" height="400">' +
                '<img src="/img/2.png" width="400" height="400">' +
                '<img src="/img/3.png" width="400" height="400">' +
                "</div></body></html>",
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    return { server, base: `http://127.0.0.1:${port}` };
};

test("legacy extractor runs first, browser is the fallback, and failures retry", async () => {
    test.setTimeout(360_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-legacy-out-"));
    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-legacy-extractor-"));
    const extractorPath = path.join(fixtureDir, "fixture_extractor.py");
    const recipeDir = path.join(appDir, "userdata", "downloader-recipes");
    const recipePath = path.join(recipeDir, "legacy-fixture-recipe.json");

    fs.writeFileSync(
        extractorPath,
        [
            "import time",
            "from urllib.parse import urlparse",
            "",
            "def extract_manga_info(url):",
            "    parts = urlparse(url)",
            "    base = f'{parts.scheme}://{parts.netloc}'",
            "    if parts.path.startswith('/legacy/ok') or parts.path.startswith('/recipe/ok'):",
            "        return ('Legacy Series', [base + '/img/1.png', base + '/img/2.png', base + '/clip.mp4'], {'User-Agent': 'legacy-test'})",
            "    if parts.path.startswith('/legacy/broken'):",
            "        return ('Broken Series', [base + '/missing.png'], {})",
            "    if parts.path.startswith('/legacy/hang'):",
            "        time.sleep(10)",
            "        return ('Slow Series', [base + '/img/1.png'], {})",
            "    raise RuntimeError('extractor does not know this site')",
            "",
        ].join("\n"),
        "utf8",
    );

    const fixtures = await Promise.all([
        startFixture(),
        startFixture(),
        startFixture(),
        startFixture(),
        startFixture(),
    ]);
    const [okSource, brokenSource, failSource, hangSource, recipeSource] = fixtures;
    const okUrl = `${okSource.base}/legacy/ok`;
    const brokenUrl = `${brokenSource.base}/legacy/broken`;
    const failUrl = `${failSource.base}/legacy/fail`;
    const hangUrl = `${hangSource.base}/legacy/hang`;
    const recipeUrl = `${recipeSource.base}/recipe/ok`;

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: {
            ...process.env,
            NODE_ENV: "production",
            YOPOMURA_DOWNLOADER_REVIEW: "0",
            YOPOMURA_DOWNLOADER_EXTRACTOR_PATH: extractorPath,
            YOPOMURA_LEGACY_PROBE_MS: "1500",
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

        const preview = (url: string) =>
            page.evaluate(async (target) => {
                const bridge = (
                    window as unknown as {
                        electron: {
                            invoke: (
                                channel: string,
                                arg?: unknown,
                            ) => Promise<{
                                ok: boolean;
                                images: number;
                                source: string;
                                message: string;
                            }>;
                        };
                    }
                ).electron;
                return bridge.invoke("downloader:preview", { url: target });
            }, url);

        const addJob = (url: string) =>
            page.evaluate(
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

        const legacyPreview = await preview(okUrl);
        console.log("LEGACY_PREVIEW", legacyPreview);
        expect(legacyPreview.ok).toBe(true);
        expect(legacyPreview.source).toBe("extractor");
        expect(legacyPreview.images).toBe(2);

        const legacyJob = await addJob(okUrl);
        await expect
            .poll(
                async () =>
                    page.evaluate(async (jobId) => {
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
                                            source: string;
                                        }>;
                                    }>;
                                };
                            }
                        ).electron;
                        const state = await bridge.invoke("downloader:getState");
                        const job = state.jobs.find((row) => row.id === jobId);
                        return job ? `${job.status}:${job.downloaded}:${job.source}` : "";
                    }, legacyJob.id),
                { timeout: 120_000 },
            )
            .toBe("done:2:extractor");

        const failPreview = await preview(failUrl);
        console.log("FAIL_PREVIEW", failPreview);
        expect(failPreview.ok).toBe(true);
        expect(failPreview.source).toBe("browser");
        expect(failPreview.images).toBe(3);

        const brokenPreview = await preview(brokenUrl);
        console.log("BROKEN_PREVIEW", brokenPreview);
        expect(brokenPreview.source).toBe("extractor");
        const brokenJob = await addJob(brokenUrl);
        await expect
            .poll(
                async () =>
                    page.evaluate(async (jobId) => {
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
                                            source: string;
                                            message: string;
                                        }>;
                                    }>;
                                };
                            }
                        ).electron;
                        const state = await bridge.invoke("downloader:getState");
                        const job = state.jobs.find((row) => row.id === jobId);
                        return job ? `${job.status}:${job.downloaded}:${job.source}` : "";
                    }, brokenJob.id),
                { timeout: 180_000 },
            )
            .toBe("done:3:browser");

        const hangPreview = await preview(hangUrl);
        console.log("HANG_PREVIEW", hangPreview);
        expect(hangPreview.ok).toBe(true);
        expect(hangPreview.source).toBe("browser");
        expect(hangPreview.images).toBe(3);

        fs.mkdirSync(recipeDir, { recursive: true });
        fs.writeFileSync(
            recipePath,
            JSON.stringify(
                {
                    schemaVersion: 1,
                    id: "legacy-fixture-recipe",
                    name: "Legacy Fixture Recipe",
                    match: ["/\\/recipe\\/ok$/"],
                    mode: "gallery",
                    pages: { selector: ".reader img", attributes: ["src"] },
                },
                null,
                2,
            ),
            "utf8",
        );
        const recipePreview = await preview(recipeUrl);
        console.log("RECIPE_PREVIEW", recipePreview);
        expect(recipePreview.source).toBe("recipe");
        expect(recipePreview.images).toBe(3);

        expect(errors).toEqual([]);
        console.log("DOWNLOADER_LEGACY_FIRST_OK");
    } finally {
        await app.close();
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.rmSync(fixtureDir, { recursive: true, force: true });
        fs.rmSync(recipePath, { force: true });
        for (const fixture of fixtures) fixture.server.close();
    }
});
