import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/** Side panes and Settings must remain reachable above every full panel. */
test("side panes and settings layer above media and trash", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
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

        // Media stays behind the browser side pane, downloader and Settings.
        await page.locator(".mediaToggle").click();
        await page.waitForSelector(".mediaPanelOverlay", { timeout: 15_000 });
        await page.locator(".browserSideToggle").click();
        await page.waitForSelector(".browserHost.is-side", { timeout: 15_000 });
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(1);
        const sideHit = await page.evaluate(() => {
            const node = document.elementFromPoint(window.innerWidth - 80, window.innerHeight / 2);
            return Boolean(node?.closest(".browserHost"));
        });
        expect(sideHit).toBe(true);
        await page.locator(".browserSideToggle").click();
        await expect(page.locator(".browserHost")).toHaveCount(0);
        await expect(page.locator(".mediaPanelOverlay")).toBeVisible();

        await page.locator(".downloaderToggle").click();
        await page.waitForSelector(".downloaderPanel", { timeout: 15_000 });
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(1);
        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();

        await page.locator(".settingsBtn").click();
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "open");
        const settingsHit = await page.evaluate(() => {
            const node = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
            return Boolean(node?.closest("#settings"));
        });
        expect(settingsHit).toBe(true);
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "closed");
        await expect(page.locator(".mediaPanelOverlay")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(0);
        console.log("MEDIA_LAYERING_OK");

        // Trash no longer blocks the TopBar: browser side and Settings still open.
        await page.locator(".trashToggle").click();
        await page.waitForSelector(".trashPanel", { timeout: 15_000 });
        await expect(page.locator(".trashPanelEyebrow")).toHaveText("Recently deleted");
        await page.locator(".browserSideToggle").click();
        await page.waitForSelector(".browserHost.is-side", { timeout: 15_000 });
        await expect(page.locator(".trashPanel")).toHaveCount(1);
        await page.locator(".browserSideToggle").click();
        await expect(page.locator(".browserHost")).toHaveCount(0);
        await page.locator(".downloaderToggle").click();
        await page.waitForSelector(".downloaderPanel", { timeout: 15_000 });
        await expect(page.locator(".trashPanel")).toHaveCount(1);
        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();
        await expect(page.locator(".trashPanel")).toBeVisible();
        await page.locator(".settingsBtn").click();
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "open");
        await expect(page.locator(".trashPanel")).toHaveCount(1);
        await page.keyboard.press("Escape");
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "closed");
        await expect(page.locator(".trashPanel")).toBeVisible();
        await page.locator(".trashPanelClose").click();
        await expect(page.locator(".trashPanel")).toHaveCount(0);
        console.log("TRASH_LAYERING_OK");

        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
    }
});
