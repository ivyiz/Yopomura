import fs from "node:fs";
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
    const width = 120;
    const height = 120;
    const row = Buffer.alloc(width * 3);
    for (let index = 0; index < width; index += 1) {
        row[index * 3] = (seed * 41 + index) % 255;
        row[index * 3 + 1] = (seed * 71 + index) % 255;
        row[index * 3 + 2] = (seed * 101 + index) % 255;
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

test("reader focus closes the browser and toolbar panels toggle", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const mangaDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-reader-focus-"));
    fs.writeFileSync(path.join(mangaDir, "001.png"), makePng(1));
    fs.writeFileSync(path.join(mangaDir, "002.png"), makePng(2));

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

        // The Downloader toolbar button toggles instead of always opening.
        await page.locator(".downloaderToggle").click();
        await expect(page.locator(".downloaderPanel")).toBeVisible();
        await page.locator(".downloaderToggle").click();
        await expect(page.locator(".downloaderPanel")).toHaveCount(0);

        // Opening a title must close both the browser view and the downloader.
        await page.locator(".browserToggle").click();
        await expect(page.locator(".browserHost.is-full")).toHaveCount(1);
        await page.locator(".downloaderToggle").click();
        await expect(page.locator(".downloaderPanel")).toBeVisible();

        await app.evaluate(({ BrowserWindow }, link) => {
            BrowserWindow.getAllWindows()[0]?.webContents.send("reader:loadLink", { link });
        }, mangaDir);

        await expect(page.locator(".browserHost")).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator(".downloaderPanel")).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator("#reader")).toBeVisible({ timeout: 30_000 });

        // Media is full-screen and owns the keyboard, so the reader must unmount.
        await page.locator(".mediaToggle").click();
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(1, { timeout: 15_000 });
        await expect(page.locator("#reader")).toHaveCount(0);

        expect(errors).toEqual([]);
        console.log("READER_FOCUS_OK");
    } finally {
        await app.close();
        fs.rmSync(mangaDir, { recursive: true, force: true });
    }
});
