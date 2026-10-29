import fs from "node:fs";
import path from "node:path";
import type { DownloaderRecipeDraft, DownloaderRecipeSummary } from "@common/types/downloader";
import { app } from "electron";

export type RecipeSelector = string | { selector: string; attribute?: string };

export type DownloaderRecipe = {
    schemaVersion?: number;
    id: string;
    name?: string;
    enabled?: boolean;
    /** Host names, `*.example.com` wildcards, or `/regex/` patterns. */
    match: string[];
    mode?: "auto" | "gallery" | "reader" | "series";
    title?: RecipeSelector;
    waitFor?: string;
    chapters?: {
        selector: string;
        linkAttribute?: string;
        nameAttribute?: string;
        limit?: number;
    };
    pages?: {
        selector: string;
        /** Attributes checked in order; defaults to common lazy-image attributes. */
        attributes?: string[];
    };
    next?: {
        selector: string;
        attribute?: string;
    };
    /** Optional page-context script; runs only in the sandboxed recipe browser. */
    script?: string;
    /** URL substrings/regexes removed from the final page list. */
    exclude?: string[];
};

const safeId = (value: string): string =>
    value
        .trim()
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 80);

const selectorOf = (value: RecipeSelector | undefined): { selector: string; attribute: string } | null => {
    if (!value) return null;
    if (typeof value === "string") return { selector: value, attribute: "text" };
    if (!value.selector) return null;
    return { selector: value.selector, attribute: value.attribute || "text" };
};

/** Validates a parsed recipe; returns null for files that are not safe to use. */
export const validateRecipe = (value: unknown): DownloaderRecipe | null => {
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<DownloaderRecipe>;
    if (typeof row.id !== "string" || !row.id.trim()) return null;
    if (!Array.isArray(row.match) || row.match.length === 0) return null;
    if (!row.match.every((item) => typeof item === "string" && item.trim())) return null;
    const hasScript = typeof row.script === "string" && row.script.trim().length > 0;
    if (!hasScript) {
        if (!row.pages || typeof row.pages !== "object" || typeof row.pages.selector !== "string") {
            return null;
        }
        if (!row.pages.selector.trim()) return null;
    }
    if (row.chapters !== undefined) {
        if (!row.chapters || typeof row.chapters.selector !== "string" || !row.chapters.selector.trim()) {
            return null;
        }
    }
    if (row.next !== undefined && (!row.next || typeof row.next.selector !== "string")) return null;
    if (row.title !== undefined && !selectorOf(row.title)) return null;
    if (row.exclude !== undefined && !Array.isArray(row.exclude)) return null;
    return {
        ...row,
        id: safeId(row.id),
        name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : row.id,
        match: row.match.map((item) => item.trim().toLowerCase()),
        pages: row.pages
            ? {
                  selector: row.pages.selector.trim(),
                  attributes: Array.isArray(row.pages.attributes)
                      ? row.pages.attributes.filter((item): item is string => typeof item === "string")
                      : undefined,
              }
            : undefined,
        script: hasScript ? row.script?.trim() : undefined,
    };
};

const hostOf = (url: string): string => {
    try {
        return new URL(url).hostname.toLowerCase();
    } catch {
        return "";
    }
};

/** True when one of the recipe's match entries accepts this URL. */
export const recipeMatches = (recipe: DownloaderRecipe, url: string): boolean => {
    const host = hostOf(url);
    if (!host) return false;
    for (const pattern of recipe.match) {
        if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
            try {
                if (new RegExp(pattern.slice(1, -1), "i").test(url)) return true;
            } catch {
                // invalid regex in a recipe is ignored
            }
            continue;
        }
        const suffix = pattern.replace(/^\*\./, "").replace(/^\./, "");
        if (host === suffix || host.endsWith(`.${suffix}`)) return true;
    }
    return false;
};

class RecipeStore {
    private folderPath(): string {
        return path.join(app.getPath("userData"), "downloader-recipes");
    }

    folder(): string {
        const folder = this.folderPath();
        fs.mkdirSync(folder, { recursive: true });
        return folder;
    }

    list(): DownloaderRecipeSummary[] {
        const folder = this.folder();
        let files: string[] = [];
        try {
            files = fs.readdirSync(folder).filter((file) => file.toLowerCase().endsWith(".json"));
        } catch {
            return [];
        }
        const rows: DownloaderRecipeSummary[] = [];
        for (const file of files) {
            try {
                const parsed = validateRecipe(JSON.parse(fs.readFileSync(path.join(folder, file), "utf8")));
                if (!parsed) continue;
                rows.push({
                    id: parsed.id,
                    name: parsed.name || parsed.id,
                    hosts: parsed.match,
                    mode: parsed.mode || "auto",
                    file,
                });
            } catch {
                // skip invalid recipe files
            }
        }
        return rows.sort((left, right) => left.name.localeCompare(right.name));
    }

    read(id: string): DownloaderRecipe | null {
        const summary = this.list().find((row) => row.id === safeId(id));
        if (!summary) return null;
        try {
            return validateRecipe(JSON.parse(fs.readFileSync(path.join(this.folder(), summary.file), "utf8")));
        } catch {
            return null;
        }
    }

    match(url: string): DownloaderRecipe | null {
        const candidates = this.list();
        let best: DownloaderRecipe | null = null;
        let bestScore = -1;
        for (const summary of candidates) {
            const recipe = this.read(summary.id);
            if (!recipe || recipe.enabled === false || !recipeMatches(recipe, url)) continue;
            const score = Math.max(...recipe.match.map((item) => item.replace(/^\*\./, "").length));
            if (score > bestScore) {
                best = recipe;
                bestScore = score;
            }
        }
        return best;
    }

    importFile(sourcePath: string): DownloaderRecipe | null {
        const parsed = validateRecipe(JSON.parse(fs.readFileSync(sourcePath, "utf8")));
        if (!parsed) return null;
        fs.mkdirSync(this.folder(), { recursive: true });
        fs.writeFileSync(path.join(this.folder(), `${parsed.id}.json`), JSON.stringify(parsed, null, 2), "utf8");
        return parsed;
    }

    save(recipe: DownloaderRecipe): DownloaderRecipe | null {
        const parsed = validateRecipe(recipe);
        if (!parsed) return null;
        fs.mkdirSync(this.folder(), { recursive: true });
        fs.writeFileSync(path.join(this.folder(), `${parsed.id}.json`), JSON.stringify(parsed, null, 2), "utf8");
        return parsed;
    }

    saveDraft(draft: DownloaderRecipeDraft): DownloaderRecipe | null {
        const pageSelector = draft.pageSelector?.trim();
        const script = draft.script?.trim();
        if (!pageSelector && !script) return null;
        return this.save({
            schemaVersion: 1,
            id: draft.id,
            name: draft.name || draft.id,
            match: draft.match,
            mode: draft.mode,
            title: draft.titleSelector?.trim()
                ? { selector: draft.titleSelector.trim(), attribute: "text" }
                : undefined,
            chapters:
                draft.mode === "series" && draft.chapterSelector?.trim()
                    ? { selector: draft.chapterSelector.trim() }
                    : undefined,
            pages: pageSelector
                ? {
                      selector: pageSelector,
                      attributes: ["data-src", "src", "srcset", "data-original"],
                  }
                : undefined,
            next: draft.nextSelector?.trim()
                ? { selector: draft.nextSelector.trim(), attribute: "href" }
                : undefined,
            script: script || undefined,
        });
    }

    remove(id: string): boolean {
        const summary = this.list().find((row) => row.id === safeId(id));
        if (!summary) return false;
        try {
            fs.unlinkSync(path.join(this.folder(), summary.file));
            return true;
        } catch {
            return false;
        }
    }
}

export const recipeStore = new RecipeStore();

/** Shape sent to the page-side recipe extractor. */
export type PageRecipeConfig = {
    title: { selector: string; attribute: string } | null;
    waitFor: string;
    chapters: {
        selector: string;
        linkAttribute: string;
        nameAttribute: string;
        limit: number;
    } | null;
    pages: { selector: string; attributes: string[] };
    next: { selector: string; attribute: string } | null;
    exclude: string[];
};

export const pageRecipeConfig = (recipe: DownloaderRecipe): PageRecipeConfig => ({
    title: selectorOf(recipe.title),
    waitFor: typeof recipe.waitFor === "string" ? recipe.waitFor : "",
    chapters: recipe.chapters
        ? {
              selector: recipe.chapters.selector,
              linkAttribute: recipe.chapters.linkAttribute || "href",
              nameAttribute: recipe.chapters.nameAttribute || "text",
              limit: recipe.chapters.limit || 0,
          }
        : null,
    pages: {
        selector: recipe.pages?.selector ?? "",
        attributes:
            recipe.pages?.attributes && recipe.pages.attributes.length > 0
                ? recipe.pages.attributes
                : ["src", "data-src", "data-original", "data-lazy-src", "data-url"],
    },
    next: recipe.next ? { selector: recipe.next.selector, attribute: recipe.next.attribute || "href" } : null,
    exclude: (recipe.exclude || []).filter((item) => typeof item === "string" && item.trim()),
});
