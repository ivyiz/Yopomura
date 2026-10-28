import http from "node:http";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

/** A crashed browser renderer must be recreated instead of leaving the globe fallback. */
test("browser renderer crash recovers the native view", async () => {
    test.setTimeout(180_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const server = http.createServer((_request, response) => {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end("<!doctype html><title>Crash Page</title><h1>Crash Page</h1>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const target = `http://127.0.0.1:${port}/`;

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
        await page.locator(".browserAddress").fill(target);
        await page.locator(".browserAddress").press("Enter");
        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Crash Page");

        const crashed = await app.evaluate(({ webContents }, url) => {
            const view = webContents.getAllWebContents().find((item) => item.getURL() === url);
            if (!view) return false;
            view.forcefullyCrashRenderer();
            return true;
        }, target);
        expect(crashed).toBe(true);
        await page.waitForTimeout(1000);

        await expect
            .poll(
                async () =>
                    app.evaluate(async ({ webContents }, url) => {
                        const views = webContents
                            .getAllWebContents()
                            .filter((item) => item.getURL() === url && !item.isDestroyed());
                        if (views.length === 0) return 0;
                        const image = await views[0].capturePage();
                        return image.isEmpty() ? 0 : image.toJPEG(80).length;
                    }, target),
                { timeout: 30_000 },
            )
            .toBeGreaterThan(0);

        await expect
            .poll(async () => (await page.locator(".browserTab.is-active").innerText()).trim(), {
                timeout: 20_000,
            })
            .toContain("Crash Page");
        expect(errors).toEqual([]);
        console.log("BROWSER_CRASH_RECOVERY_OK");
    } finally {
        await app.close();
        server.close();
    }
});
