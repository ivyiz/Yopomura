import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const PNG_1X1 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFBSURBVHhe7ZfBDYJAFAWphErowhsF2IShASrwypWzFXDyZg+GhDK+UVHwSUII+HfNeyRzGVgSJ8vumqRZbswkKNhQABRsKAAKNhQABRsKgIINBUDBhgKgYEMBULChACjYUAAUbCgACjYUAAUbKwMcrGpt0XWtDxPvCYd7gOd1seLrXWHYLsD5OHH/k+I8atCebDfxjDeuAe7s6q4f0Fm1/77vjXuANDta0w+JYT0IEGAYQxqAfAYQrwGwZc4+78N2AZZckWyBd5wDxDHtx2wXYGpK7092ff/4eE5/Y34b4MGw6vPNgBcRzwSfAB/b3/yznrgFwAWzKfF+GBwD5JaWl6FAJJ+CbwD4S0x5FI5tVwgQAD6FwKfClQH+HwVAwYYCoGBDAVCwoQAo2FAAFGwoAAo2FAAFGwqAgg0FQMEGfYAbcEx5E9o3oXkAAAAASUVORK5CYII=";

test("location favourite and reader browser modes", async () => {
    test.setTimeout(180_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const libraryDir = path.join(os.tmpdir(), "yokomura-mega-test");
    const readerDir = path.join(libraryDir, "Reader Test");
    fs.mkdirSync(readerDir, { recursive: true });
    fs.writeFileSync(path.join(readerDir, "001.png"), Buffer.from(PNG_1X1, "base64"));

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: { ...process.env, NODE_ENV: "production" },
    });
    try {
        const page = await app.firstWindow();
        await page.waitForSelector(".locationRow", { timeout: 90_000 });
        await page.evaluate(async (link) => {
            const bridge = (
                window as unknown as {
                    electron: { invoke: (channel: string, arg?: unknown) => Promise<unknown> };
                }
            ).electron;
            await bridge.invoke("db:library:addItem", {
                type: "manga",
                data: { link, title: "Reader Test", type: "manga" },
            });
        }, readerDir);
        await page.waitForTimeout(800);

        const readerRow = page.locator(".locationRow", { hasText: "Reader Test" }).first();
        await expect(readerRow).toBeVisible();

        // A: right-click -> Add to Favourites
        await readerRow.click({ button: "right" });
        await page.locator(".contextMenu li", { hasText: "Add to Favourites" }).click();
        await page.waitForTimeout(400);
        const favourite = await page.evaluate(async (link) => {
            const bridge = (
                window as unknown as {
                    electron: { invoke: (channel: string, arg?: unknown) => Promise<unknown> };
                }
            ).electron;
            const rows = (await bridge.invoke("db:library:getAllAndProgress")) as Array<{
                link: string;
                favouritedAt: string | null;
            }>;
            return rows.find((row) => row.link === link)?.favouritedAt ?? null;
        }, readerDir);
        expect(favourite).not.toBeNull();
        console.log("LOCATION_FAVOURITE_ADD_OK");

        // A: right-click -> Remove from Favourites
        await readerRow.click({ button: "right" });
        await page.locator(".contextMenu li", { hasText: "Remove from Favourites" }).click();
        await page.waitForTimeout(400);
        const removed = await page.evaluate(async (link) => {
            const bridge = (
                window as unknown as {
                    electron: { invoke: (channel: string, arg?: unknown) => Promise<unknown> };
                }
            ).electron;
            const rows = (await bridge.invoke("db:library:getAllAndProgress")) as Array<{
                link: string;
                favouritedAt: string | null;
            }>;
            return rows.find((row) => row.link === link)?.favouritedAt ?? null;
        }, readerDir);
        expect(removed).toBeNull();
        console.log("LOCATION_FAVOURITE_REMOVE_OK");

        // B: open reader via context menu
        await readerRow.click({ button: "right" });
        await page.locator(".contextMenu li", { hasText: /^Open$/ }).click();
        await page.waitForSelector("#reader", { timeout: 20_000 });
        const readerWidthBefore = await page
            .locator("#reader")
            .evaluate((element) => element.getBoundingClientRect().width);
        const viewportWidth = await page.evaluate(() => window.innerWidth);

        await page.locator(".browserSideToggle").click();
        await page.waitForSelector(".browserHost.is-side", { timeout: 15_000 });
        const readerWidthAfter = await page
            .locator("#reader")
            .evaluate((element) => element.getBoundingClientRect().width);
        expect(readerWidthAfter).toBeLessThan(readerWidthBefore);
        expect(readerWidthAfter).toBeLessThan(viewportWidth - 300);

        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator('.browserTabStrip button[title="Close browser"]').click();
        await expect(page.locator(".browserHost")).toHaveCount(0);
        await expect(page.locator("#reader")).toBeVisible();
        console.log("READER_BROWSER_MODES_OK");
    } finally {
        await app.close();
    }
});
