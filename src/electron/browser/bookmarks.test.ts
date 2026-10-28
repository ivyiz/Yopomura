import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BROWSER_BOOKMARKS_FILE, createBookmarkStore, normalizeBookmarkUrl } from "./bookmarks";

const dirs: string[] = [];

const makeStore = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yomikiru-bookmarks-"));
    dirs.push(dir);
    const file = path.join(dir, BROWSER_BOOKMARKS_FILE);
    return { dir, file, store: createBookmarkStore(file) };
};

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("browser bookmarks", () => {
    it("normalizes http(s) URLs and rejects everything else", () => {
        expect(normalizeBookmarkUrl("https://example.com")).toBe("https://example.com/");
        expect(normalizeBookmarkUrl("http://example.com/path?q=1")).toBe("http://example.com/path?q=1");
        expect(normalizeBookmarkUrl("javascript:alert(1)")).toBeNull();
        expect(normalizeBookmarkUrl("file:///C:/secret.txt")).toBeNull();
        expect(normalizeBookmarkUrl("not a url")).toBeNull();
    });

    it("adds, deduplicates, updates and removes bookmarks", () => {
        const { store, file } = makeStore();
        const first = store.add({
            url: "https://example.com",
            title: "Example",
            favicon: "https://example.com/i.png",
        });
        expect(first?.title).toBe("Example");
        expect(first?.favicon).toBe("https://example.com/i.png");
        expect(store.list()).toHaveLength(1);

        const duplicate = store.add({ url: "https://example.com/", title: "Another" });
        expect(duplicate?.id).toBe(first?.id);
        expect(store.list()).toHaveLength(1);

        const id = first?.id ?? "";
        const updated = store.update(id, "  Renamed   page  ");
        expect(updated?.title).toBe("Renamed page");
        expect(store.list()[0]?.title).toBe("Renamed page");

        expect(store.remove("missing")).toBe(false);
        expect(store.remove(id)).toBe(true);
        expect(store.list()).toEqual([]);

        const persisted = JSON.parse(fs.readFileSync(file, "utf8")) as { version: number };
        expect(persisted.version).toBe(1);
    });

    it("falls back to the hostname when the title is empty", () => {
        const { store } = makeStore();
        const bookmark = store.add({ url: "https://example.com/deep/page", title: "   " });
        expect(bookmark?.title).toBe("example.com");
    });

    it("ignores data favicons and invalid stored rows", () => {
        const { dir, file, store } = makeStore();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
            file,
            JSON.stringify({
                version: 1,
                bookmarks: [
                    { id: "a", url: "https://ok.example/", title: "ok", favicon: "data:image/png;base64,AAAA" },
                    { id: "b", url: "javascript:alert(1)", title: "bad" },
                    { id: "c", url: "https://ok.example/", title: "duplicate" },
                ],
            }),
            "utf8",
        );

        const list = store.list();
        expect(list).toHaveLength(1);
        expect(list[0]?.favicon).toBe("");
    });

    it("starts empty when the file is corrupt", () => {
        const { dir, file, store } = makeStore();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, "{not json", "utf8");
        expect(store.list()).toEqual([]);

        const bookmark = store.add({ url: "https://example.com", title: "Recovered" });
        expect(bookmark).not.toBeNull();
        expect(store.list()).toHaveLength(1);
    });
});
