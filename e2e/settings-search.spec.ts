import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/** Settings search must be clickable above the modal and jump to the target. */
test("settings search navigates to the selected setting", async () => {
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
        await page.locator(".settingsBtn").click();
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "open");

        const input = page.locator(".settingsSearch input").first();
        await expect(page.locator(".tabMovers button").first()).toHaveCSS("text-transform", "none");
        await input.fill("proxy");
        const proxyHit = page.locator(".itemList li", { hasText: "Browser proxy" }).first();
        await expect(proxyHit).toBeVisible();
        await proxyHit.click();
        await expect(page.locator("#settings-networkProxy")).toHaveClass(/settings-target-highlight/);
        await expect(page.locator("#settings-networkProxy")).toBeVisible();
        await expect(page.locator("#settings-networkProxy")).toBeInViewport();
        console.log("SETTINGS_SEARCH_PROXY_OK");

        await input.fill("dark mode");
        const darkHit = page.locator(".itemList li", { hasText: "Browser" }).first();
        await expect(darkHit).toBeVisible();
        await darkHit.click();
        await expect(page.locator("#settings-browser")).toHaveClass(/settings-target-highlight/);
        await expect(page.locator("#settings-browser")).toBeVisible();
        await expect(
            page.locator("#settings-browser input[type=checkbox][aria-label='Force dark mode']"),
        ).toBeVisible();
        console.log("SETTINGS_SEARCH_DARK_OK");

        await input.fill("zzzz-not-a-setting");
        await expect(page.locator(".itemList li")).toContainText("No matching settings");

        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
        await expect(page.locator("#settings")).toHaveAttribute("data-state", "closed");
        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
    }
});
