import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/**
 * End-to-end smoke: media player, browser tabs/side pane, trash undo, downloader panel.
 *
 * Prerequisites (local Windows machine):
 * - `pnpm package` produced `out/Yokomura-win32-x64/Yokomura.exe` with its portable `userdata`.
 * - That userdata's default library folder points at `%TEMP%\yokomura-mega-test`.
 * - The folder contains `sample.webm` (VP8/VP9) and a disposable `DELETE-ME.zip`.
 *
 * The spec is skipped when those fixtures are absent so it never deletes a real file.
 */
test("mega features smoke", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yokomura-win32-x64");
    const libraryDir = path.join(os.tmpdir(), "yokomura-mega-test");
    const target = path.join(libraryDir, "sample.webm");
    const deletable = path.join(libraryDir, "DELETE-ME.zip");
    const permanent = path.join(libraryDir, "PERM-DELETE-ME.zip");
    test.skip(
        !fs.existsSync(target) || !fs.existsSync(deletable),
        "requires the yokomura-mega-test fixtures and a matching portable userdata",
    );
    fs.copyFileSync(deletable, permanent);

    const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
            "<!doctype html><html><head><title>Test Browser Page</title></head><body><h1>Browser OK</h1></body></html>",
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yokomura.exe"),
        cwd: appDir,
        env: { ...process.env, NODE_ENV: "production" },
    });
    const errors: string[] = [];
    try {
        await app.evaluate(({ dialog }) => {
            (dialog as unknown as { showMessageBox: unknown }).showMessageBox = async () => ({
                response: 1,
                checkboxChecked: false,
            });
        });
        const page = await app.firstWindow();
        page.on("pageerror", (err) => errors.push(err.message));
        await page.waitForSelector(".locationRow", { timeout: 90_000 });
        await page.waitForTimeout(2500);
        await page.keyboard.press("Escape");

        // Location list has its own always-visible draggable scrollbar.
        const scrollbar = await page.locator("#locationTab .location-cont").evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
                overflowY: style.overflowY,
                scrollbarWidth: el.offsetWidth - el.clientWidth,
            };
        });
        console.log("LOCATION_SCROLLBAR", scrollbar);
        expect(scrollbar.overflowY).toBe("scroll");
        expect(scrollbar.scrollbarWidth).toBeGreaterThan(8);

        // Media player
        await page.locator(".locationRow", { hasText: "sample" }).first().click();
        await page.waitForSelector(".videoPlayerOverlay", { timeout: 15_000 });
        const video = page.locator(".videoPlayerOverlay video");
        await expect(video).toHaveCount(1);
        await expect
            .poll(() => video.evaluate((el) => (el as HTMLVideoElement).readyState), { timeout: 20_000 })
            .toBeGreaterThan(0);
        console.log("MEDIA_OK", await video.evaluate((el) => (el as HTMLVideoElement).src));
        await page.locator('.videoPlayerOverlay button[aria-label="Close video player"]').click();
        await expect(page.locator(".videoPlayerOverlay")).toHaveCount(0);

        // Full browser
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator(".browserAddress").fill(`http://127.0.0.1:${port}/`);
        await page.locator(".browserAddress").press("Enter");
        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Test Browser Page");
        console.log("BROWSER_TITLE", await page.locator(".browserTab.is-active").innerText());
        await page.locator(".browserNewTab").click();
        await expect(page.locator(".browserTab")).toHaveCount(2);
        await page.locator('.browserTabStrip button[title="Close browser"]').click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        // TopBar globe toggles the browser closed instead of only opening it.
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator(".browserToggle").click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        // Side pane from Location toggles too.
        await page.locator('.listCont .tools button[data-tooltip="Browser"]').click();
        await page.waitForSelector(".browserHost.is-side", { timeout: 15_000 });
        await expect(page.locator(".browserHost.is-side")).toBeVisible();
        await page.locator('.listCont .tools button[data-tooltip="Browser"]').click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        // Trash: countdown panel + recovery
        const row = page.locator(".locationRow", { hasText: "DELETE-ME" }).first();
        await row.click({ button: "right" });
        await page.waitForSelector(".contextMenu", { timeout: 10_000 });
        await page.getByText("Move to Recently Deleted", { exact: true }).last().click();
        await page.waitForSelector(".trashToast", { timeout: 20_000 });
        await expect.poll(() => fs.existsSync(deletable), { timeout: 15_000 }).toBe(false);
        await page.locator(".trashToast button", { hasText: "View" }).click();
        await page.waitForSelector(".trashPanel", { timeout: 15_000 });
        const trashRow = page.locator(".trashRow", { hasText: "DELETE-ME" }).first();
        await expect(trashRow).toHaveCount(1);
        await expect
            .poll(async () => (await trashRow.locator(".trashRowMeta").innerText()).trim(), { timeout: 10_000 })
            .toMatch(/days left|hours left|minutes left/);
        console.log("TRASH_COUNTDOWN", await trashRow.locator(".trashRowMeta").innerText());
        await trashRow.getByRole("button", { name: "Recover" }).click();
        await expect.poll(() => fs.existsSync(deletable), { timeout: 20_000 }).toBe(true);
        await expect(page.locator(".trashRow", { hasText: "DELETE-ME" })).toHaveCount(0);
        console.log("TRASH_RECOVER_OK");
        await page.locator(".trashPanelClose").click();
        await expect(page.locator(".trashPanel")).toHaveCount(0);

        // Delete forever removes the file immediately.
        const permanentRow = page.locator(".locationRow", { hasText: "PERM-DELETE-ME" }).first();
        await permanentRow.click({ button: "right" });
        await page.waitForSelector(".contextMenu", { timeout: 10_000 });
        await page.getByText("Move to Recently Deleted", { exact: true }).last().click();
        await page.waitForSelector(".trashToast", { timeout: 20_000 });
        await expect.poll(() => fs.existsSync(permanent), { timeout: 15_000 }).toBe(false);
        await page.locator(".trashToast button", { hasText: "View" }).click();
        await page.waitForSelector(".trashPanel", { timeout: 15_000 });
        const permanentTrashRow = page.locator(".trashRow", { hasText: "PERM-DELETE-ME" }).first();
        await expect(permanentTrashRow).toHaveCount(1);
        await permanentTrashRow.getByRole("button", { name: "Delete forever" }).click();
        await expect(page.locator(".trashRow", { hasText: "PERM-DELETE-ME" })).toHaveCount(0);
        console.log("TRASH_DELETE_OK");
        await page.locator(".trashPanelClose").click();
        await expect(page.locator(".trashPanel")).toHaveCount(0);

        // Downloader panel + packaged worker
        await page.locator(".downloaderToggle").click();
        await page.waitForSelector(".downloaderPanel", { timeout: 15_000 });
        await expect
            .poll(
                async () =>
                    page.evaluate(async () => {
                        const bridge = (
                            window as unknown as {
                                electron: { invoke: (channel: string) => Promise<{ ready: boolean }> };
                            }
                        ).electron;
                        const state = await bridge.invoke("downloader:getState");
                        return state.ready;
                    }),
                { timeout: 30_000 },
            )
            .toBe(true);
        console.log("DOWNLOADER_OK");
        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();

        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
        server.close();
    }
});
