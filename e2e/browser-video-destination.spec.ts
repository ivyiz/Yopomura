import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

test("browser video downloads land in the media folder, not the manga library", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const body = Buffer.from("webm-fixture");

    const server = http.createServer((request, response) => {
        if (request.url !== "/clip.webm") {
            response.writeHead(404).end();
            return;
        }
        response.writeHead(200, {
            "Content-Type": "video/webm",
            "Content-Length": String(body.length),
            "Content-Disposition": 'attachment; filename="clip.webm"',
        });
        response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    const app = await electron.launch({
        executablePath: path.join(appDir, "Yopomura.exe"),
        cwd: appDir,
        env: { ...process.env, NODE_ENV: "production" },
    });
    let videoPath = "";
    try {
        const page = await app.firstWindow();
        await page.waitForSelector(".locationRow", { timeout: 60_000 });
        const videoDir = path.join(
            await app.evaluate(({ app: electronApp }) => electronApp.getPath("videos")),
            "Yopomura",
        );
        videoPath = path.join(videoDir, "clip.webm");
        fs.rmSync(videoPath, { force: true });

        await page.evaluate(() => {
            const target = window as unknown as {
                __lastSavePath?: string;
                electron: {
                    on: (
                        channel: string,
                        listener: (download: { state: string; savePath: string }) => void,
                    ) => () => void;
                };
            };
            target.__lastSavePath = "";
            target.electron.on("browser:download", (download) => {
                if (download.state === "completed") target.__lastSavePath = download.savePath;
            });
        });

        await page.locator(".browserToggle").click();
        await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
        await page.locator(".browserAddress").fill(`http://127.0.0.1:${port}/clip.webm`);
        await page.locator(".browserAddress").press("Enter");

        await expect
            .poll(
                () => page.evaluate(() => (window as unknown as { __lastSavePath?: string }).__lastSavePath ?? ""),
                { timeout: 30_000 },
            )
            .toBe(videoPath);
        await expect.poll(() => fs.existsSync(videoPath), { timeout: 10_000 }).toBe(true);

        await page.locator('.browserTabStrip button[title="Close browser"]').click();
        await expect(page.locator(".browserHost")).toHaveCount(0);

        await page.locator(".mediaToggle").click();
        await page.waitForSelector(".mediaPanelOverlay", { timeout: 15_000 });
        await expect(page.locator(".mediaPanelRecentList li", { hasText: "clip" })).toHaveCount(1);
        await page.locator(".mediaPanelRecentClear").click();
        await expect(page.locator(".mediaPanelLibraryList li", { hasText: "clip" })).toHaveCount(1);
        console.log("BROWSER_VIDEO_DESTINATION_OK");
    } finally {
        await app.close();
        server.close();
        if (videoPath) fs.rmSync(videoPath, { force: true });
    }
});
