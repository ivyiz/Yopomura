import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/** Media control bar stays hidden until the pointer enters its bottom dock. */
test("media controls hide until hovered", async () => {
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
        await page.locator(".mediaToggle").click();
        await page.waitForSelector(".mediaPanelVideo", { timeout: 20_000 });

        const controls = page.locator(".mediaPanelControls");
        const dock = page.locator(".mediaPanelControlsDock");
        const stageBox = await page.locator(".mediaPanelStage").boundingBox();
        if (!stageBox) throw new Error("media stage not found");

        await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
        await page.waitForTimeout(350);
        await expect(controls).toHaveCSS("opacity", "0");

        await dock.hover();
        await expect(controls).toHaveCSS("opacity", "1");
        await expect(page.locator('button[aria-label="Playback speed"]')).toBeVisible();

        await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
        await page.waitForTimeout(350);
        await expect(controls).toHaveCSS("opacity", "0");

        // Keyboard focus keeps the bar available.
        await page.locator('button[aria-label="Playback speed"]').focus();
        await expect(controls).toHaveCSS("opacity", "1");
        await page.locator('button[aria-label="Playback speed"]').click();
        await expect(page.locator(".mediaPanelSpeedMenu")).toBeVisible();
        await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2);
        await page.waitForTimeout(350);
        await expect(controls).toHaveCSS("opacity", "1");
        console.log("MEDIA_CONTROLS_HOVER_OK");

        expect(errors).toEqual([]);
    } finally {
        await app.close();
    }
});
