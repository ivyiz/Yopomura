#!/usr/bin/env tsx
/**
 * Public-content guard: keeps explicit site presets and site-specific
 * extractor hints out of the public tree. It intentionally checks domains,
 * not general words (AniList legitimately has a "Doujinshi" genre label).
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SCAN_ROOTS = ["src", "downloader", "e2e", "scripts", "docs", "README.md", "PRIVACY.md"] as const;
const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".json", ".md", ".py", ".txt", ".yml", ".yaml", ".html"]);
const BLOCKED = [
    "nhentai.net",
    "hitomi.la",
    "imhentai.xxx",
    "hentaivnx.com",
    "vi-hentai.moe",
    "hanime.tv",
    "watchhentai.net",
    "hentaihaven.xxx",
    "damconuong.icu",
    "curl_cffi",
] as const;

const files: string[] = [];
const collect = (target: string): void => {
    if (!fs.existsSync(target)) return;
    const stat = fs.statSync(target);
    if (stat.isFile()) {
        if (TEXT_EXTENSIONS.has(path.extname(target).toLowerCase())) files.push(target);
        return;
    }
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "__pycache__") continue;
        collect(path.join(target, entry.name));
    }
};

for (const relative of SCAN_ROOTS) collect(path.join(ROOT, relative));

const hits: string[] = [];
for (const file of files) {
    // The guard itself contains the blocklist literals.
    if (path.basename(file) === "check-public-content.ts") continue;
    const text = fs.readFileSync(file, "utf8").toLowerCase();
    for (const blocked of BLOCKED) {
        if (!text.includes(blocked)) continue;
        const lines = text.split(/\r?\n/);
        const lineIndex = lines.findIndex((line) => line.includes(blocked));
        hits.push(`${path.relative(ROOT, file)}:${lineIndex + 1} contains "${blocked}"`);
    }
}

if (hits.length > 0) {
    console.error("Public content guard failed:");
    for (const hit of hits) console.error(`  ${hit}`);
    process.exit(1);
}

console.log(`Public content guard passed (${files.length} files scanned).`);
