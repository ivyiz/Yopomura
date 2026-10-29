import fs from "node:fs";
import http from "node:http";
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
const chunk = (tag: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(tag, "ascii"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, tail]);
};
const png = (): Buffer => {
    const width = 320;
    const height = 320;
    const row = Buffer.alloc(width * 3, 120);
    const raw = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), row])));
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", header),
        chunk("IDAT", zlib.deflateSync(raw)),
        chunk("IEND", Buffer.alloc(0)),
    ]);
};

test("visual recipe builder creates and saves a working recipe", async () => {
    test.setTimeout(300_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const image = png();
    const server = http.createServer((request, response) => {
        const url = request.url || "/";
        const html = (body: string) => {
            response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            response.end(`<!doctype html><html><body>${body}</body></html>`);
        };
        if (url === "/builder/series") {
            html(
                '<h1>Builder Series</h1><div class="chapter-list">' +
                    '<a href="/builder/ch1">Chapter 1</a><a href="/builder/ch2">Chapter 2</a></div>',
            );
            return;
        }
        if (url === "/builder/ch1") {
            html(
                '<div class="reader">' +
                    '<img src="/builder/1.png" width="320" height="320">' +
                    '<img src="/builder/2.png" width="320" height="320">' +
                    "</div>",
            );
            return;
        }
        if (url === "/builder/ch2") {
            html(
                '<div class="reader">' +
                    '<img src="/builder/3.png" width="320" height="320">' +
                    '<img src="/builder/4.png" width="320" height="320">' +
                    "</div>",
            );
            return;
        }
        if (/^\/builder\/[1-4]\.png$/.test(url)) {
            response.writeHead(200, { "Content-Type": "image/png" });
            response.end(image);
            return;
        }
        response.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const seriesUrl = `http://127.0.0.1:${port}/builder/series`;
    const recipePath = path.join(appDir, "userdata", "downloader-recipes", `127-0-0-1.json`);

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: { ...process.env, NODE_ENV: "production" },
    });
    const errors: string[] = [];
    try {
        const page = await app.firstWindow();
        page.on("pageerror", (error) => errors.push(error.message));
        await page.waitForSelector(".locationRow", { timeout: 60_000 });
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator(".browserAddress").fill(seriesUrl);
        await page.locator(".browserAddress").press("Enter");
        await page.waitForSelector(".browserTab.is-active", { timeout: 15_000 });
        await page.waitForTimeout(2500);

        await app.evaluate(({ dialog }) => {
            let call = 0;
            (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({
                response: call++ === 0 ? 1 : 0,
                checkboxChecked: false,
            });
        });

        const draftPromise = page.evaluate(async () => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (channel: string) => Promise<{
                            id: string;
                            mode: string;
                            chapterSelector?: string;
                            pageSelector?: string;
                        }>;
                    };
                }
            ).electron;
            return bridge.invoke("browser:buildRecipe");
        });

        await page.waitForTimeout(900);
        await app.evaluate(async ({ webContents }) => {
            const views = webContents.getAllWebContents().filter((item) => !item.isDestroyed());
            const view = views.find((item) => item.getURL().includes("/builder/series"));
            await view?.executeJavaScript(`document.querySelector(".chapter-list a")?.click()`);
        });

        await page.waitForTimeout(1800);
        await app.evaluate(async ({ webContents }) => {
            const views = webContents.getAllWebContents().filter((item) => !item.isDestroyed());
            const view = views.find((item) => item.getURL().includes("/builder/ch1"));
            await view?.executeJavaScript(`document.querySelector(".reader img")?.click()`);
        });
        const draft = await draftPromise;
        expect(draft.mode).toBe("series");
        expect(draft.chapterSelector).toContain("a");
        expect(draft.pageSelector).toContain("img");

        const saved = await page.evaluate(async (value) => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (channel: string, arg?: unknown) => Promise<{ ok: boolean }>;
                    };
                }
            ).electron;
            return bridge.invoke("downloader:saveRecipe", value);
        }, draft);
        expect(saved.ok).toBe(true);

        const preview = await page.evaluate(async (url) => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (
                            channel: string,
                            arg?: unknown,
                        ) => Promise<{
                            ok: boolean;
                            mode: string;
                            images: number;
                        }>;
                    };
                }
            ).electron;
            return bridge.invoke("downloader:preview", { url });
        }, seriesUrl);
        console.log("BUILDER_PREVIEW", preview);
        expect(preview.ok).toBe(true);
        expect(preview.mode).toBe("series");
        expect(preview.images).toBe(4);
        expect(errors).toEqual([]);
        console.log("RECIPE_BUILDER_OK");
    } finally {
        await app.close();
        server.close();
        fs.rmSync(recipePath, { force: true });
    }
});
