import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * Side browser must sit beside every home view (classic, history, gallery) and
 * leave modals/popovers usable instead of covering their right edge.
 */
test("side browser across classic, history, and gallery views", async () => {
    test.setTimeout(180_000);
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
        await page.waitForTimeout(1200);

        const sideGeometry = () =>
            page.evaluate(() => {
                const viewport = window.innerWidth;
                const host = document.querySelector(".browserHost.is-side")?.getBoundingClientRect();
                const appRect = document.querySelector("#app")?.getBoundingClientRect();
                return {
                    viewport,
                    hostWidth: host?.width ?? 0,
                    hostLeft: host?.left ?? 0,
                    appWidth: appRect?.width ?? 0,
                };
            });

        // Classic home: the app gives the side pane its own column.
        await page.locator(".browserSideToggle").click();
        await page.waitForSelector(".browserHost.is-side", { timeout: 15_000 });
        const classic = await sideGeometry();
        expect(classic.appWidth + classic.hostWidth).toBeCloseTo(classic.viewport, 0);
        await expect(page.locator(".browserStart")).toBeVisible();

        // Toggling the History column keeps the side pane open and sized.
        await page.locator(".tabCont .divider").click();
        await page.waitForTimeout(400);
        if ((await page.locator("#historyTab").count()) === 0) {
            await page.locator(".tabCont .divider").click();
            await page.waitForTimeout(400);
        }
        await expect(page.locator(".browserHost.is-side")).toBeVisible();
        await expect(page.locator("#historyTab")).toBeVisible();
        const history = await sideGeometry();
        expect(history.appWidth + history.hostWidth).toBeCloseTo(history.viewport, 0);

        // Settings opens above the app and stays clear of the side pane.
        await page.locator(".settingsBtn").click();
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "open");
        const settings = await page.evaluate(() => {
            const modal = document.querySelector("#settings .overflowWrap")?.getBoundingClientRect();
            const host = document.querySelector(".browserHost.is-side")?.getBoundingClientRect();
            if (!modal || !host) return null;
            const probeX = Math.min(modal.right - 18, window.innerWidth - 18);
            const probeY = modal.top + 28;
            const hit = document.elementFromPoint(probeX, probeY)?.closest("#settings");
            return {
                modalRight: modal.right,
                hostLeft: host.left,
                hitsSettings: Boolean(hit),
            };
        });
        expect(settings).not.toBeNull();
        expect(settings?.modalRight ?? 0).toBeLessThanOrEqual((settings?.hostLeft ?? 0) + 1);
        expect(settings?.hitsSettings).toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "closed");

        // Gallery view keeps the side pane and the app column split.
        await page.locator(".viewToggle button").click();
        await page.waitForSelector(".galleryView", { timeout: 15_000 });
        await expect(page.locator(".browserHost.is-side")).toBeVisible();
        const gallery = await sideGeometry();
        expect(gallery.appWidth + gallery.hostWidth).toBeCloseTo(gallery.viewport, 0);

        // A top-bar popover still wins over the side pane.
        await page.locator(".bookmarkToggle").click();
        await expect(page.locator(".popover")).toBeVisible();
        await page.keyboard.press("Escape");
        await page.waitForTimeout(250);

        // Downloader is an app-level overlay; it must cover the pane.
        await page.locator(".downloaderToggle").click();
        await page.waitForSelector(".downloaderPanel", { timeout: 15_000 });
        const downloaderHits = await page.evaluate(() => {
            const probe = document.elementFromPoint(window.innerWidth - 80, window.innerHeight / 2);
            return Boolean(probe?.closest(".downloaderOverlay"));
        });
        expect(downloaderHits).toBe(true);
        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();

        // Back to classic and close from the Location toolbar button.
        await page.locator(".viewToggle button").click();
        await page.waitForSelector(".locationRow", { timeout: 15_000 });
        await page.locator('.listCont .tools button[data-tooltip="Browser"]').click();
        await expect(page.locator(".browserHost")).toHaveCount(0);
        await page.locator('.listCont .tools button[data-tooltip="Browser"]').click();
        await page.waitForSelector(".browserHost.is-side", { timeout: 15_000 });

        // Dragging the resizer keeps the app column in sync with the pane.
        const beforeResize = await sideGeometry();
        const resizer = await page.locator(".browserSideResizer").boundingBox();
        if (resizer) {
            await page.mouse.move(resizer.x + resizer.width / 2, resizer.y + 120);
            await page.mouse.down();
            await page.mouse.move(resizer.x + resizer.width / 2 - 90, resizer.y + 120, { steps: 6 });
            await page.mouse.up();
            await page.waitForTimeout(350);
        }
        const afterResize = await sideGeometry();
        expect(afterResize.hostWidth).toBeGreaterThan(beforeResize.hostWidth + 40);
        expect(afterResize.appWidth + afterResize.hostWidth).toBeCloseTo(afterResize.viewport, 0);

        await page.locator(".browserSideToggle").click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        console.log("SIDE_BROWSER_TABS_OK", { classic, history, gallery, beforeResize, afterResize });
        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
    }
});
