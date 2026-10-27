import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTrashJournal, TRASH_JOURNAL_FILE, type TrashJournal } from "./journal";

type TestJournal = {
    dir: string;
    filePath: string;
    journal: TrashJournal;
};

const tempDirs: string[] = [];

const makeJournal = (): TestJournal => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yomikiru-trash-journal-"));
    tempDirs.push(dir);
    return {
        dir,
        filePath: path.join(dir, TRASH_JOURNAL_FILE),
        journal: createTrashJournal(dir),
    };
};

const readRaw = (filePath: string): string => fs.readFileSync(filePath, "utf8");

const tempFiles = (dir: string): string[] => fs.readdirSync(dir).filter((name) => name.endsWith(".tmp"));

const append = (journal: TrashJournal, name: string, extra: { deletedAt?: number; error?: string } = {}) =>
    journal.appendTrashEntry({
        originalPath: path.join("C:\\library", name),
        name,
        kind: name.includes(".") ? "file" : "folder",
        itemType: "manga",
        title: name,
        ...extra,
    });

afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
});

describe("createTrashJournal", () => {
    it("creates a missing journal and writes BOM-free, 2-space JSON", async () => {
        const { journal, filePath } = makeJournal();
        expect(fs.existsSync(filePath)).toBe(false);

        expect(await journal.listTrashEntries()).toEqual([]);
        expect(fs.existsSync(filePath)).toBe(true);

        const entry = await append(journal, "chapter-01.cbz");
        expect(entry.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(entry.name).toBe("chapter-01.cbz");
        expect(entry.kind).toBe("file");
        expect(entry.status).toBe("trashed");
        expect(entry.itemType).toBe("manga");
        expect(entry.title).toBe("chapter-01.cbz");
        expect(Number.isFinite(entry.deletedAt)).toBe(true);

        const raw = readRaw(filePath);
        expect(raw.charCodeAt(0)).not.toBe(0xfeff);
        expect(raw).toBe(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);

        const rows = JSON.parse(raw) as Array<{ originalPath: string }>;
        expect(Array.isArray(rows)).toBe(true);
        expect(rows).toHaveLength(1);
        expect(rows[0]?.originalPath).toBe(path.join("C:\\library", "chapter-01.cbz"));
        expect(tempFiles(path.dirname(filePath))).toEqual([]);
    });

    it("persists app-trash countdown fields", async () => {
        const { journal } = makeJournal();
        const entry = await journal.appendTrashEntry({
            originalPath: path.join("C:\\library", "One Piece.zip"),
            kind: "file",
            title: "One Piece",
            itemType: "manga",
            storage: "app",
            trashPath: path.join("C:\\userdata", "trash", "abc", "One Piece.zip"),
            deletedAt: 1_000,
            expiresAt: 1_000 + 7 * 24 * 60 * 60 * 1000,
            retentionDays: 7,
        });

        expect(entry.storage).toBe("app");
        expect(entry.trashPath).toContain("trash");
        expect(entry.retentionDays).toBe(7);
        expect(entry.expiresAt).toBe(1_000 + 7 * 24 * 60 * 60 * 1000);
        expect(await journal.getEntry(entry.id)).toEqual(entry);

        const legacy = await append(journal, "legacy.cbz");
        expect(legacy.storage).toBe("recycle-bin");
        expect(legacy.expiresAt).toBeUndefined();
    });

    it("serializes concurrent appends so every entry survives", async () => {
        const { journal, filePath } = makeJournal();
        const entries = await Promise.all(
            Array.from({ length: 12 }, (_, index) => append(journal, `book-${index}.epub`, { deletedAt: index })),
        );

        expect(new Set(entries.map((entry) => entry.id)).size).toBe(12);
        const listed = await journal.listTrashEntries();
        expect(listed).toHaveLength(12);
        expect(JSON.parse(readRaw(filePath))).toHaveLength(12);
        expect(tempFiles(path.dirname(filePath))).toEqual([]);
    });

    it("lists newest-first and applies limit without mutating the journal", async () => {
        const { journal } = makeJournal();
        await append(journal, "old.cbz", { deletedAt: 1_000 });
        await append(journal, "new.cbz", { deletedAt: 3_000 });
        await append(journal, "middle.cbz", { deletedAt: 2_000 });

        const all = await journal.listTrashEntries();
        expect(all.map((entry) => entry.name)).toEqual(["new.cbz", "middle.cbz", "old.cbz"]);

        const limited = await journal.listTrashEntries({ limit: 2 });
        expect(limited.map((entry) => entry.name)).toEqual(["new.cbz", "middle.cbz"]);
        expect(await journal.listTrashEntries({ limit: 0 })).toEqual([]);
        expect(await journal.listTrashEntries({ limit: -5 })).toEqual([]);
        expect(await journal.listTrashEntries()).toHaveLength(3);
    });

    it("gets, marks restored, and removes entries", async () => {
        const { journal } = makeJournal();
        const entry = await append(journal, "volume-1", { error: "trash reported an odd code" });

        expect(await journal.getEntry(entry.id)).toEqual(entry);

        const restored = await journal.markRestored(entry.id);
        expect(restored).not.toBeNull();
        if (!restored) throw new Error("expected markRestored to return the updated entry");
        expect(restored.status).toBe("restored");
        expect(Number.isFinite(restored.restoredAt)).toBe(true);
        expect(restored.error).toBeUndefined();
        expect(await journal.getEntry(entry.id)).toEqual(restored);
        expect(await journal.markRestored("not-an-id")).toBeNull();

        expect(await journal.removeEntry(entry.id)).toBe(true);
        expect(await journal.removeEntry(entry.id)).toBe(false);
        expect(await journal.getEntry(entry.id)).toBeNull();
        expect(await journal.listTrashEntries()).toEqual([]);
    });

    it("prunes entries older than the retention window", async () => {
        const { journal } = makeJournal();
        const stale = await append(journal, "stale.cbz", { deletedAt: 1_000 });
        await append(journal, "boundary.cbz", { deletedAt: 9_000 });
        await append(journal, "fresh.cbz", { deletedAt: 9_500 });

        expect(await journal.pruneOlderThan(1_000, 10_000)).toBe(1);
        const remaining = await journal.listTrashEntries();
        expect(remaining.map((entry) => entry.name)).toEqual(["fresh.cbz", "boundary.cbz"]);
        expect(remaining.some((entry) => entry.id === stale.id)).toBe(false);
        expect(await journal.pruneOlderThan(10_000, 10_000)).toBe(0);
    });

    it("recreates a corrupt journal instead of throwing", async () => {
        const { journal, filePath } = makeJournal();
        fs.writeFileSync(filePath, "{ this is not json", "utf8");

        expect(await journal.listTrashEntries()).toEqual([]);
        expect(JSON.parse(readRaw(filePath))).toEqual([]);

        const entry = await append(journal, "after-corrupt.cbz");
        expect(await journal.listTrashEntries()).toEqual([entry]);
        expect(tempFiles(path.dirname(filePath))).toEqual([]);
    });

    it("keeps the previous journal when writing the temp file fails", async () => {
        const { journal, filePath } = makeJournal();
        const first = await append(journal, "first.cbz");
        const before = readRaw(filePath);

        vi.spyOn(fsp, "writeFile").mockRejectedValueOnce(new Error("disk full"));
        await expect(append(journal, "second.cbz")).rejects.toThrow("disk full");

        expect(readRaw(filePath)).toBe(before);
        expect(await journal.listTrashEntries()).toEqual([first]);
        expect(tempFiles(path.dirname(filePath))).toEqual([]);
    });

    it("falls back to unlink-then-rename when Windows refuses to replace the journal", async () => {
        const { journal, filePath } = makeJournal();
        const first = await append(journal, "first.cbz");

        const eperm = Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
        vi.spyOn(fsp, "rename").mockRejectedValueOnce(eperm);

        const second = await append(journal, "second.cbz");
        const listed = await journal.listTrashEntries();
        expect(listed.map((entry) => entry.id).sort()).toEqual([first.id, second.id].sort());
        expect(JSON.parse(readRaw(filePath))).toHaveLength(2);
        expect(tempFiles(path.dirname(filePath))).toEqual([]);
    });
});
