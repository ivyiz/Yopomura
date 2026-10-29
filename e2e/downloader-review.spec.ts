import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type { ElectronApplication } from "@playwright/test";
import { _electron as electron, expect, test } from "@playwright/test";

const setWindowSize = async (app: ElectronApplication, width: number, height: number): Promise<void> => {
    await app.evaluate(
        ({ BrowserWindow }, size) => {
            const win = BrowserWindow.getAllWindows()[0];
            win?.setBounds({ width: size.width, height: size.height });
        },
        { width, height },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
};

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

        // Keep a browser tab open: review must hide the native view without closing the browser.
        await page.locator(".browserToggle").click();
        await expect(page.locator(".browserHost.is-full")).toHaveCount(1);
        await page.locator(".browserAddress").fill(url);
        await page.locator(".browserAddress").press("Enter");
        await expect(page.locator(".browserTab.is-active")).toHaveCount(1, { timeout: 20_000 });

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
        await expect(page.locator(".browserHost")).toHaveCount(1);
        const browserTabs = await page.evaluate(async () => {
            const bridge = (
                window as unknown as {
                    electron: {
                        invoke: (channel: string) => Promise<{ tabs: Array<{ id: string }> }>;
                    };
                }
            ).electron;
            const state = await bridge.invoke("browser:getState");
            return state.tabs.length;
        });
        expect(browserTabs).toBeGreaterThan(0);
        const rows = page.locator(".downloaderReviewItem");
        await expect(rows).toHaveCount(3);
        await expect(page.locator(".downloaderReviewItem input:checked")).toHaveCount(3);
        await expect(page.locator(".downloaderReviewCount")).toContainText("3 / 3 selected");

        const measureGrid = () =>
            page.evaluate(() => {
                const items = Array.from(document.querySelectorAll<HTMLElement>(".downloaderReviewItem"));
                const thumbs = items.map((item) => item.querySelector<HTMLElement>(".downloaderReviewThumb"));
                const top = thumbs[0]?.getBoundingClientRect().top ?? 0;
                const firstRow = thumbs.filter(
                    (thumb) => Math.abs((thumb?.getBoundingClientRect().top ?? 0) - top) < 2,
                ).length;
                const thumbRect = thumbs[0]?.getBoundingClientRect();
                const boxRect = items[0]?.querySelector("input")?.getBoundingClientRect();
                const overlay = getComputedStyle(
                    items[0]?.querySelector(".downloaderReviewThumb") as Element,
                    "::after",
                ).backgroundColor;
                return {
                    firstRow,
                    thumbHeight: Math.round(thumbRect?.height ?? 0),
                    checkboxInside: Boolean(
                        thumbRect &&
                            boxRect &&
                            boxRect.left >= thumbRect.left &&
                            boxRect.top >= thumbRect.top &&
                            boxRect.right <= thumbRect.right &&
                            boxRect.bottom <= thumbRect.bottom,
                    ),
                    overlay,
                };
            });

        const wide = await measureGrid();
        expect(wide.firstRow).toBe(3);
        expect(wide.thumbHeight).toBe(240);
        expect(wide.checkboxInside).toBe(true);
        expect(wide.overlay).toBe("rgba(0, 0, 0, 0)");

        await setWindowSize(app, 1200, 800);
        await expect.poll(async () => (await measureGrid()).firstRow).toBe(3);

        // The window has a 853px minimum, so emulate narrower viewports for the fallback columns.
        const cdp = await page.context().newCDPSession(page);
        const emulateWidth = (width: number) =>
            cdp.send("Emulation.setDeviceMetricsOverride", {
                width,
                height: 900,
                deviceScaleFactor: 1,
                mobile: false,
            });
        await emulateWidth(800);
        await expect.poll(async () => (await measureGrid()).firstRow).toBe(2);
        await emulateWidth(500);
        await expect.poll(async () => (await measureGrid()).firstRow).toBe(1);
        await cdp.send("Emulation.clearDeviceMetricsOverride");
        await expect.poll(async () => (await measureGrid()).firstRow).toBe(3);

        const typography = await page.evaluate(() =>
            ["#topBar .title", ".downloaderReviewName", ".downloaderReviewHost", ".downloaderReviewConfirm"].map(
                (selector) => {
                    const element = document.querySelector<HTMLElement>(selector);
                    if (!element) return null;
                    const style = getComputedStyle(element);
                    return { selector, family: style.fontFamily, spacing: style.letterSpacing };
                },
            ),
        );
        for (const sample of typography) {
            if (!sample) continue;
            expect(sample.family).toContain("Roboto");
            expect(sample.spacing).toBe("normal");
        }

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
        await page.mouse.move(0, 0);
        await expect.poll(async () => (await measureGrid()).overlay).toBe("rgba(0, 0, 0, 0.55)");
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
        await expect(page.locator(".browserHost")).toHaveCount(1);

        // The brand must stay clear of the Trash button as the window narrows.
        for (const width of [1920, 1200, 900, 700]) {
            await setWindowSize(app, width, 800);
            await expect
                .poll(async () =>
                    page.evaluate(() => {
                        const brand = document.querySelector<HTMLElement>("#topBar .mainTitleCont");
                        const trash = Array.from(
                            document.querySelectorAll<HTMLElement>("#topBar .homeBtns button"),
                        ).find((button) => button.querySelector('svg[data-icon="trash"]'));
                        if (!brand || !trash) return -10_000;
                        return Math.round(
                            brand.getBoundingClientRect().left - trash.getBoundingClientRect().right,
                        );
                    }),
                )
                .toBeGreaterThanOrEqual(0);
        }

        expect(errors).toEqual([]);
        console.log("DOWNLOADER_REVIEW_OK");
    } finally {
        await app.close();
        server.close();
        fs.rmSync(outDir, { recursive: true, force: true });
    }
});
