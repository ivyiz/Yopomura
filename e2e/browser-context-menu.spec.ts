import http from "node:http";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/** Browser right-click menu stays open, background tabs, and the accumulating Downloader draft. */
test("browser context menu, background tabs and downloader draft", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
            "<!doctype html><html><head><title>Menu Page</title></head><body>" +
                '<a href="/one">One</a><a href="/two">Two</a></body></html>',
        );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

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

        const pageUrl = `http://127.0.0.1:${port}/`;
        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator(".browserAddress").fill(pageUrl);
        await page.locator(".browserAddress").press("Enter");
        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Menu Page");

        const tabId = await page.evaluate(async () => {
            const bridge = (
                window as unknown as {
                    electron: { invoke: (channel: string) => Promise<{ activeId: string }> };
                }
            ).electron;
            const state = await bridge.invoke("browser:getState");
            return state.activeId;
        });

        const openMenu = async (linkURL: string) => {
            await app.evaluate(
                ({ BrowserWindow }, payload) => {
                    const window = BrowserWindow.getAllWindows()[0];
                    window?.webContents.send("browser:contextMenu", {
                        ...payload,
                        pageURL: payload.pageUrl,
                        selectionText: "",
                        x: 160,
                        y: 140,
                    });
                },
                { tabId, linkURL, pageUrl },
            );
            await page.waitForSelector(".browserContextMenu", { timeout: 10_000 });
        };

        // Leaving the menu with the mouse must not dismiss it.
        await openMenu(`${pageUrl}one`);
        await page.mouse.move(4, 4);
        await page.waitForTimeout(500);
        await expect(page.locator(".browserContextMenu")).toBeVisible();

        // Escape closes only the menu; the browser stays open.
        await page.keyboard.press("Escape");
        await expect(page.locator(".browserContextMenu")).toHaveCount(0);
        await expect(page.locator(".browserHost.is-full")).toHaveCount(1);

        // "Open in new tab" must leave the current tab active.
        await openMenu(`${pageUrl}two`);
        await page.locator(".browserContextMenu button", { hasText: "Open in new tab" }).click();
        await expect(page.locator(".browserTab")).toHaveCount(2);
        await expect(page.locator(".browserTab.is-active")).toContainText("Menu Page");

        const sendLink = async (linkURL: string) => {
            await page.locator(".downloaderClose").click();
            await expect(page.locator(".downloaderPanel")).toHaveCount(0);
            await openMenu(linkURL);
            await page.locator(".browserContextMenu button", { hasText: "Send link to Downloader" }).click();
            await expect(page.locator(".downloaderPanel")).toBeVisible();
        };

        const firstLink = `${pageUrl}one`;
        const secondLink = `${pageUrl}two`;
        await openMenu(firstLink);
        await page.locator(".browserContextMenu button", { hasText: "Send link to Downloader" }).click();
        await expect(page.locator(".downloaderCompose textarea")).toHaveValue(firstLink);

        // Draft survives closing the pane.
        await page.locator(".downloaderClose").click();
        await expect(page.locator(".downloaderPanel")).toHaveCount(0);
        await page.locator(".downloaderToggle").click();
        await expect(page.locator(".downloaderCompose textarea")).toHaveValue(firstLink);

        // The history icon toggles queue/history and the queue draft is untouched.
        await page.locator(".downloaderHistoryBtn").click();
        await expect(page.locator(".downloaderHistory")).toBeVisible();
        await page.locator(".downloaderHistoryBtn").click();
        await expect(page.locator(".downloaderCompose textarea")).toHaveValue(firstLink);

        // Sending the same link twice keeps one line; a new link appends.
        await sendLink(firstLink);
        await expect(page.locator(".downloaderCompose textarea")).toHaveValue(firstLink);
        await sendLink(secondLink);
        await expect(page.locator(".downloaderCompose textarea")).toHaveValue(`${firstLink}\n${secondLink}`);

        console.log("BROWSER_CONTEXT_MENU_DRAFT_OK");
        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
        server.close();
    }
});
