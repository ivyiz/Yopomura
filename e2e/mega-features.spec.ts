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
    const backupPath = path.join(os.tmpdir(), `yokomura-profile-e2e-${Date.now()}.zip`);
    test.skip(
        !fs.existsSync(target) || !fs.existsSync(deletable),
        "requires the yokomura-mega-test fixtures and a matching portable userdata",
    );
    fs.copyFileSync(deletable, permanent);

    const server = http.createServer((_req, res) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
            "<!doctype html><html><head><title>Test Browser Page</title></head><body><h1>Browser OK</h1>" +
                '<a href="/gallery/one">Gallery One</a>' +
                '<a href="/gallery/two">Gallery Two</a>' +
                "</body></html>",
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
        await app.evaluate(({ dialog }, destination) => {
            (dialog as unknown as { showSaveDialog: unknown }).showSaveDialog = async () => ({
                canceled: false,
                filePath: destination,
            });
        }, backupPath);
        await app.evaluate(({ dialog }, folder) => {
            (dialog as unknown as { showOpenDialog: unknown }).showOpenDialog = async () => ({
                canceled: false,
                filePaths: [folder],
            });
        }, libraryDir);
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

        // Full profile backup ZIP (native save dialog is stubbed above).
        const backup = (await page.evaluate(async () => {
            const bridge = (
                window as unknown as {
                    electron: { invoke: (channel: string) => Promise<unknown> };
                }
            ).electron;
            return bridge.invoke("profileBackup:create");
        })) as { ok: boolean; path?: string; bytes?: number; message?: string };
        console.log("PROFILE_BACKUP", backup);
        expect(backup.ok).toBe(true);
        expect(fs.existsSync(backupPath)).toBe(true);
        expect(fs.statSync(backupPath).size).toBeGreaterThan(1_000);

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

        // Dedicated YouTube-style media panel (Media icon on the TopBar).
        await page.locator(".mediaToggle").click();
        await page.waitForSelector(".mediaPanelOverlay", { timeout: 15_000 });
        const mediaTop = await page
            .locator(".mediaPanelOverlay")
            .evaluate((el) => Number.parseFloat(window.getComputedStyle(el).top));
        expect(mediaTop).toBeGreaterThan(0);
        // Scan depth selector and the YouTube-style autoplay toggle.
        const depthSelect = page.locator(".mediaPanelDepth select");
        await expect(depthSelect).toHaveValue("8");
        await depthSelect.selectOption("all");
        await expect.poll(async () => depthSelect.inputValue(), { timeout: 10_000 }).toBe("all");
        await depthSelect.selectOption("8");
        await expect(depthSelect).toHaveValue("8");
        const autoplayToggle = page.locator(".mediaPanelAutoplayToggle");
        await expect(autoplayToggle).toHaveAttribute("aria-pressed", "true");
        await autoplayToggle.click();
        await expect(page.locator(".mediaPanelAutoplayNotice")).toContainText("Autoplay is off");
        await expect(autoplayToggle).toHaveAttribute("aria-pressed", "false");
        await autoplayToggle.click();
        await expect(autoplayToggle).toHaveAttribute("aria-pressed", "true");
        await page.waitForSelector(".mediaPanelVideo, .mediaPanelList li", { timeout: 20_000 });
        const mediaItem = page.locator(".mediaPanelList li", { hasText: "sample" }).first();
        if (await mediaItem.count()) await mediaItem.click();
        const mediaVideo = page.locator(".mediaPanelVideo");
        await expect(mediaVideo).toHaveCount(1);
        await expect
            .poll(() => mediaVideo.evaluate((el) => (el as HTMLVideoElement).readyState), { timeout: 20_000 })
            .toBeGreaterThan(0);
        await page.locator(".mediaPanelSeek").hover();
        await expect(page.locator(".mediaPanelSeekPreview.is-visible")).toHaveCount(1);
        await page.locator('.mediaPanelControlButton[aria-label="Theater mode"]').click();
        await expect(page.locator(".mediaPanel.is-theater")).toHaveCount(1);
        await expect(page.locator(".mediaPanelVideoMeta")).toHaveCount(0);
        await expect(page.locator(".mediaPanelDescription")).toHaveCount(1);
        await expect(page.locator(".mediaPanelDescriptionFormat")).toHaveText("WEBM");
        await expect(page.locator(".mediaPanelDescriptionGrid dt").first()).toHaveText("File");
        await expect(page.locator(".mediaPanelListThumb").first()).toBeVisible();
        await page.locator(".mediaPanelDescription").scrollIntoViewIfNeeded();
        await expect(page.locator(".mediaPanelDescriptionPath")).toBeVisible();
        console.log("MEDIA_PANEL_OK");
        // Switching to another TopBar panel must close the media panel, not stack behind it.
        await page.locator(".downloaderToggle").click();
        await expect(page.locator(".downloaderPanel")).toBeVisible();
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(0);
        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();

        // Full browser
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.waitForSelector(".browserStart", { timeout: 15_000 });
        await expect(page.locator(".browserStartCard")).toHaveCount(8);
        await expect(page.locator(".browserStartIcon")).toHaveCount(8);
        await expect(page.locator(".browserStartBadge")).toHaveCount(0);
        await expect(page.locator(".browserStartCardBlurb")).toHaveCount(0);
        await expect(page.locator(".browserToolTile")).toHaveCount(6);
        console.log("BROWSER_START_OK");

        // Extensions button opens the built-in tools popover.
        await page.locator(".browserExtensionsBtn").click();
        await expect(page.locator(".browserExtensions")).toBeVisible();
        const popoverAdblock = page.locator('.browserExtensionsRow[data-action="adblock"]');
        await expect(popoverAdblock).toHaveAttribute("aria-pressed", "true");
        await popoverAdblock.click();
        await expect(popoverAdblock).toHaveAttribute("aria-pressed", "false");
        await popoverAdblock.click();
        await expect(popoverAdblock).toHaveAttribute("aria-pressed", "true");
        await page.keyboard.press("Escape");
        await expect(page.locator(".browserExtensions")).toHaveCount(0);
        await expect(page.locator(".browserHost.is-full")).toBeVisible();
        console.log("BROWSER_EXTENSIONS_OK");
        await page.locator(".browserAddress").fill(`http://127.0.0.1:${port}/`);
        await page.locator(".browserAddress").press("Enter");
        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Test Browser Page");
        console.log("BROWSER_TITLE", await page.locator(".browserTab.is-active").innerText());

        // Adblock is on by default; the shield toggles it.
        const shield = page.locator('.browserToolbar button[title^="Ad blocking"]');
        await expect(shield).toHaveAttribute("title", /^Ad blocking on/);
        await shield.click();
        await expect(shield).toHaveAttribute("title", /^Ad blocking off/);
        await shield.click();
        await expect(shield).toHaveAttribute("title", /^Ad blocking on/);

        // Scan page links and select them (do not enqueue the fake URLs).
        await page.locator('.browserToolbar button[title="Scan links on this page"]').click();
        await page.waitForSelector(".browserScanDialog", { timeout: 15_000 });
        await expect(page.locator(".browserScanRow")).toHaveCount(2);
        await page.locator(".browserScanDialog").getByRole("button", { name: "Select all" }).click();
        await expect(page.locator(".browserScanRow input:checked")).toHaveCount(2);
        console.log("BROWSER_SCAN_OK", await page.locator(".browserScanCount").innerText());
        await page.locator('.browserScanDialog button[title="Close"]').click();
        await expect(page.locator(".browserScanDialog")).toHaveCount(0);

        await page.locator(".browserNewTab").click();
        await expect(page.locator(".browserTab")).toHaveCount(2);
        await page.waitForSelector(".browserStart", { timeout: 15_000 });
        const startSearch = page.locator(".browserStartSearch input");
        await startSearch.fill(`http://127.0.0.1:${port}/`);
        await startSearch.press("Enter");
        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Test Browser Page");
        console.log("BROWSER_NEWTAB_OK");
        await page.locator('.browserTabStrip button[title="Close browser"]').click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        // TopBar globe toggles the browser closed instead of only opening it.
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator(".browserToggle").click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        // Opening the browser from the media panel closes the media panel.
        await page.locator(".mediaToggle").click();
        await page.waitForSelector(".mediaPanelOverlay", { timeout: 15_000 });
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(0);
        await page.locator('.browserTabStrip button[title="Close browser"]').click();
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
        await page.locator(".contextMenu").getByText("Delete", { exact: true }).click();
        await page.waitForSelector(".trashToast", { timeout: 20_000 });
        await expect.poll(() => fs.existsSync(deletable), { timeout: 15_000 }).toBe(false);
        // Dedicated TopBar trash icon opens the panel (toast View is covered by the other flow).
        await page.locator(".trashToggle").click();
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
        await page.locator(".contextMenu").getByText("Delete", { exact: true }).click();
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
        await expect(page.locator(".downloaderPause")).toBeDisabled();
        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();

        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
        server.close();
        fs.rmSync(backupPath, { force: true });
    }
});
