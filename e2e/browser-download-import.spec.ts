import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const PNG_1X1 =
    "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAFBSURBVHhe7ZfBDYJAFAWphErowhsF2IShASrwypWzFXDyZg+GhDK+UVHwSUII+HfNeyRzGVgSJ8vumqRZbswkKNhQABRsKAAKNhQABRsKgIINBUDBhgKgYEMBULChACjYUABUrAxwsKq1Rde1Pky8JxzuAZ7XxYqvd4VhuwDn48T9T4rzqEF7st3EM964Brizq7t+QGfV/vu+9+4B0uxoTT8khvUgQIBhDGkB8hhAvAbAljn7vA/bBVhyRbIF3nEOEMe0H7NdgKkpvT/Z9f3j4zn9jfltgAfDqs83A15EPBN8Anxsf/PPeuIWABfMpsT7YXAMkFtaXoUCknwKvgHgLzHlUTi2XSFAD6FwKfClQH+HwVAwYYCoGBDAVCwoQAo2FAAFGwoAAo2FAAFGwqAgg0FQMEGfYAbcEx5E9o3oXkAAAAASUVORK5CYII=";

test("browser downloads land in the library and recent Media playlist", async () => {
    test.setTimeout(240_000);
    const repoRoot = path.resolve(__dirname, "..");
    const appDir = path.join(repoRoot, "out", "Yopomura-win32-x64");
    const libraryDir = path.join(os.tmpdir(), "yokomura-mega-test");
    const videoSource = path.join(libraryDir, "sample.webm");
    test.skip(!fs.existsSync(videoSource), "requires the yokomura-mega-test video fixture");
    for (const file of fs.existsSync(libraryDir) ? fs.readdirSync(libraryDir) : []) {
        if (/^browser-(manga|clip)/i.test(file)) {
            fs.rmSync(path.join(libraryDir, file), { force: true });
        }
    }

    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "yopomura-download-"));
    const imagePath = path.join(sourceDir, "001.png");
    const zipPath = path.join(sourceDir, "source.zip");
    const comicPath = path.join(sourceDir, "source.cbz");
    fs.writeFileSync(imagePath, Buffer.from(PNG_1X1, "base64"));
    execFileSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        `Compress-Archive -LiteralPath '${imagePath.replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`,
    ]);
    fs.renameSync(zipPath, comicPath);

    const server = http.createServer((request, response) => {
        if (request.url === "/browser-manga.cbz") {
            response.writeHead(200, {
                "Content-Type": "application/vnd.comicbook+zip",
                "Content-Disposition": 'attachment; filename="browser-manga.cbz"',
            });
            fs.createReadStream(comicPath).pipe(response);
            return;
        }
        if (request.url === "/browser-clip.webm") {
            response.writeHead(200, {
                "Content-Type": "video/webm",
                "Content-Disposition": 'attachment; filename="browser-clip.webm"',
            });
            fs.createReadStream(videoSource).pipe(response);
            return;
        }
        response.writeHead(404).end();
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
        await page.waitForTimeout(1200);
        await page.evaluate(() => window.localStorage.removeItem("yokomura-media-recent-downloads"));

        const comicDownload = path.join(libraryDir, "browser-manga.cbz");
        await page.evaluate(
            async (links) => {
                const bridge = (
                    window as unknown as {
                        electron: { invoke: (channel: string, arg?: unknown) => Promise<unknown> };
                    }
                ).electron;
                for (const link of links) {
                    await bridge.invoke("db:library:deleteItem", { link });
                }
            },
            [libraryDir, comicDownload],
        );

        const download = async (file: string, url: string) => {
            await page.locator(".browserToggle").click();
            await page.waitForSelector(".browserHost.is-full", { timeout: 15_000 });
            await page.locator(".browserAddress").fill(url);
            await page.locator(".browserAddress").press("Enter");
            await expect.poll(() => fs.existsSync(path.join(libraryDir, file)), { timeout: 30_000 }).toBe(true);
            await page.locator('.browserTabStrip button[title="Close browser"]').click();
            await expect(page.locator(".browserHost")).toHaveCount(0);
        };

        await download("browser-manga.cbz", `http://127.0.0.1:${port}/browser-manga.cbz`);
        await expect
            .poll(
                async () =>
                    await page.evaluate(
                        async ({ root, file }) => {
                            const bridge = (
                                window as unknown as {
                                    electron: { invoke: (channel: string) => Promise<unknown> };
                                }
                            ).electron;
                            const rows = (await bridge.invoke("db:library:getAllAndProgress")) as Array<{
                                link: string;
                            }>;
                            return rows.some((row) => row.link === root || row.link === file);
                        },
                        { root: libraryDir, file: comicDownload },
                    ),
                { timeout: 45_000 },
            )
            .toBe(true);
        await expect(page.locator(".locationRow", { hasText: "browser-manga" })).toBeVisible({
            timeout: 20_000,
        });
        console.log("BROWSER_DOWNLOAD_LIBRARY_OK");

        await download("browser-clip.webm", `http://127.0.0.1:${port}/browser-clip.webm`);
        await expect(page.locator(".locationRow", { hasText: "browser-clip" })).toBeVisible({
            timeout: 20_000,
        });

        const recentPath = path.join(libraryDir, "browser-clip.webm");
        const stored = await page.evaluate(() => {
            const raw = window.localStorage.getItem("yokomura-media-recent-downloads");
            return raw ? (JSON.parse(raw) as Array<{ path: string }>) : [];
        });
        expect(stored.some((row) => row.path === recentPath)).toBe(true);

        await page.locator(".mediaToggle").click();
        await page.waitForSelector(".mediaPanelOverlay", { timeout: 15_000 });
        await expect(page.locator(".mediaPanelRecentTitle")).toContainText("Recently Downloaded");
        await expect(page.locator(".mediaPanelRecentTitle")).toHaveCSS("text-transform", "none");
        await expect(page.locator(".mediaPanelRecentList li", { hasText: "browser-clip" })).toHaveCount(1);
        await expect(page.locator(".mediaPanelRecentList .mediaPanelListCategory").first()).toContainText(
            "Downloaded",
        );
        await expect(page.locator(".mediaPanelLibraryList li", { hasText: "browser-clip" })).toHaveCount(0);
        await expect(page.locator(".mediaPanelLibraryList .mediaPanelListCategory").first()).toContainText(
            "Folder ·",
        );
        await page.locator(".mediaPanelSidebar").screenshot({ path: "test-results/media-recent-downloads.png" });
        await page.locator(".mediaPanelRecentClear").click();
        await expect(page.locator(".mediaPanelRecent")).toHaveCount(0);
        await expect(page.locator(".mediaPanelLibraryList li", { hasText: "browser-clip" })).toHaveCount(1);
        await expect(
            page
                .locator(".mediaPanelLibraryList li", { hasText: "browser-clip" })
                .locator(".mediaPanelListCategory"),
        ).toContainText("Folder ·");
        await page.keyboard.press("Escape");
        await expect(page.locator(".mediaPanelOverlay")).toHaveCount(0);
        console.log("BROWSER_DOWNLOAD_RECENT_OK");

        console.log("PAGE_ERRORS", errors);
        expect(errors).toEqual([]);
    } finally {
        await app.close();
        server.close();
        fs.rmSync(sourceDir, { recursive: true, force: true });
    }
});
