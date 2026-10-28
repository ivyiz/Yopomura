import http from "node:http";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/** Browser download actions only prefill the Downloader; nothing is queued. */
test("browser add to downloader prefills without starting a job", async () => {
    test.setTimeout(180_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(
            "<!doctype html><html><head><title>Prefill Page</title></head><body><h1>Prefill</h1></body></html>",
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

        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        const url = `http://127.0.0.1:${port}/`;
        await page.locator(".browserAddress").fill(url);
        await page.locator(".browserAddress").press("Enter");
        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Prefill Page");

        await page.locator(".browserExtensionsBtn").click();
        await page.locator('.browserExtensionsRowMain[data-action="download"]').click();
        await expect(page.locator(".downloaderPanel")).toBeVisible();
        await expect(page.locator(".downloaderCompose textarea")).toHaveValue(url);
        await expect(page.locator(".browserHost")).toHaveCount(0);
        await expect(page.locator("body")).toHaveClass(/downloaderSideOpen/);

        const layout = await page.evaluate(() => {
            const app = document.querySelector("#app")?.getBoundingClientRect();
            const pane = document.querySelector(".downloaderOverlay")?.getBoundingClientRect();
            return {
                viewport: window.innerWidth,
                appWidth: app?.width ?? 0,
                paneWidth: pane?.width ?? 0,
            };
        });
        expect(layout.paneWidth).toBeGreaterThan(400);
        expect(layout.appWidth + layout.paneWidth).toBeCloseTo(layout.viewport, 0);

        const jobs = await page.evaluate(async () => {
            const bridge = (
                window as unknown as {
                    electron: { invoke: (channel: string) => Promise<{ jobs: unknown[] }> };
                }
            ).electron;
            const state = await bridge.invoke("downloader:getState");
            return state.jobs.length;
        });
        expect(jobs).toBe(0);
        await page.locator(".downloaderOverlay").screenshot({ path: "test-results/downloader-side-pane.png" });
        console.log("DOWNLOADER_PREFILL_OK");

        await page.locator(".downloaderFoot button", { hasText: "Close" }).click();
        await expect(page.locator("body")).not.toHaveClass(/downloaderSideOpen/);
        const restored = await page.evaluate(
            () => document.querySelector("#app")?.getBoundingClientRect().width ?? 0,
        );
        expect(restored).toBeCloseTo(layout.viewport, 0);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
        server.close();
    }
});
