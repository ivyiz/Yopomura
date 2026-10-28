import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    collectProfileEntries,
    isExpectedProfileRestoreStagingPath,
    isPathInsideRoot,
    isSafeProfileRelativePath,
    profileBackupFileName,
    resolveProfileEntryPath,
    validateExtractedTree,
    validateProfileManifest,
} from "./profileBackupFiles";

const tempDirectories: string[] = [];

/** Creates a scratch directory that is removed after each test. */
const makeTempDirectory = (): string => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yokomura-profile-test-"));
    tempDirectories.push(directory);
    return directory;
};

/** Writes a file, creating parent directories as needed. */
const writeFile = (filePath: string, content = "test"): void => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
};

afterEach(() => {
    while (tempDirectories.length > 0) {
        const directory = tempDirectories.pop();
        if (directory) fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("validateProfileManifest", () => {
    const validManifest = {
        format: 1,
        appVersion: "1.2.3",
        createdAt: 1_700_000_000_000,
        files: ["data.db", "settings.json", "covers/"],
    };

    it("accepts a complete format-1 manifest", () => {
        expect(validateProfileManifest(validManifest)).toBe(true);
    });

    it.each([
        ["null", null],
        ["a string", "manifest"],
        ["the wrong format", { ...validManifest, format: 2 }],
        ["a missing app version", { ...validManifest, appVersion: undefined }],
        ["an empty app version", { ...validManifest, appVersion: "" }],
        ["a non-numeric timestamp", { ...validManifest, createdAt: "yesterday" }],
        ["an infinite timestamp", { ...validManifest, createdAt: Number.POSITIVE_INFINITY }],
        ["a non-array file list", { ...validManifest, files: "data.db" }],
        ["an empty file list", { ...validManifest, files: [] }],
        ["a non-string file", { ...validManifest, files: ["data.db", 42] }],
        ["a traversal file", { ...validManifest, files: ["../data.db"] }],
        ["an absolute file", { ...validManifest, files: ["C:/Windows/win.ini"] }],
    ])("rejects %s", (_label, value) => {
        expect(validateProfileManifest(value)).toBe(false);
    });
});

describe("collectProfileEntries", () => {
    it("collects only the profile entries that exist, in payload order", () => {
        const userData = makeTempDirectory();
        writeFile(path.join(userData, "data.db"));
        writeFile(path.join(userData, "settings.json"), "{}");
        writeFile(path.join(userData, "browser-bookmarks.json"), "{}");
        writeFile(path.join(userData, "announcements.txt"), "hello");
        writeFile(path.join(userData, "covers", "1.webp"));
        writeFile(path.join(userData, "trash", "2.webp"));
        writeFile(path.join(userData, "trash-journal.json"), "[]");

        expect(collectProfileEntries(userData)).toEqual([
            "data.db",
            "settings.json",
            "browser-bookmarks.json",
            "announcements.txt",
            "covers/",
            "trash-journal.json",
            "trash/",
        ]);
    });

    it("excludes caches, logs, i18n packs, automatic backups and restore staging", () => {
        const userData = makeTempDirectory();
        writeFile(path.join(userData, "data.db"));
        writeFile(path.join(userData, "logs", "main.log"));
        writeFile(path.join(userData, "backups", "data-1000.db"));
        writeFile(path.join(userData, "i18n-packs", "pack.json"));
        writeFile(path.join(userData, "Cache", "cache.bin"));
        writeFile(path.join(userData, "profile-restore-pending", "data.db"));

        expect(collectProfileEntries(userData)).toEqual(["data.db"]);
    });

    it("ignores a file where a profile directory is expected", () => {
        const userData = makeTempDirectory();
        writeFile(path.join(userData, "data.db"));
        writeFile(path.join(userData, "covers"), "not a directory");

        expect(collectProfileEntries(userData)).toEqual(["data.db"]);
    });

    it("returns an empty list when userData does not exist", () => {
        expect(collectProfileEntries(path.join(makeTempDirectory(), "missing"))).toEqual([]);
    });
});

describe("profile path safety", () => {
    it("accepts plain and nested relative paths", () => {
        expect(isSafeProfileRelativePath("data.db")).toBe(true);
        expect(isSafeProfileRelativePath("covers/")).toBe(true);
        expect(isSafeProfileRelativePath("covers/2026/page.webp")).toBe(true);
        expect(isSafeProfileRelativePath("covers\\2026\\page.webp")).toBe(true);
    });

    it.each([
        ["", "empty"],
        ["../data.db", "parent traversal"],
        ["covers/../../data.db", "nested traversal"],
        ["./data.db", "current-directory segment"],
        ["covers//page.webp", "empty segment"],
        ["/etc/passwd", "POSIX absolute"],
        ["\\server\\share\\data.db", "UNC absolute"],
        ["C:\\Windows\\win.ini", "Windows absolute"],
        ["data\u0000.db", "null byte"],
    ])("rejects %s (%s)", (value) => {
        expect(isSafeProfileRelativePath(value)).toBe(false);
    });

    it("resolves safe entries and rejects escapes", () => {
        const root = makeTempDirectory();

        expect(resolveProfileEntryPath(root, "data.db")).toBe(path.join(root, "data.db"));
        expect(resolveProfileEntryPath(root, "covers\\page.webp")).toBe(path.join(root, "covers", "page.webp"));
        expect(resolveProfileEntryPath(root, "../outside.txt")).toBeNull();
        expect(resolveProfileEntryPath(root, "covers/../../outside.txt")).toBeNull();
        expect(resolveProfileEntryPath(root, "C:/Windows/win.ini")).toBeNull();
        expect(resolveProfileEntryPath(root, "/etc/passwd")).toBeNull();
    });

    it("checks containment without matching sibling names that start with dots", () => {
        const root = makeTempDirectory();

        expect(isPathInsideRoot(root, path.join(root, "covers"))).toBe(true);
        expect(isPathInsideRoot(root, root)).toBe(true);
        expect(isPathInsideRoot(root, path.join(root, "..foo"))).toBe(true);
        expect(isPathInsideRoot(root, path.join(root, "..", "outside"))).toBe(false);
        expect(isPathInsideRoot(root, path.resolve(root, "..", "outside"))).toBe(false);
    });

    it("only accepts the exact pending staging directory", () => {
        const userData = makeTempDirectory();
        const expected = path.join(userData, "profile-restore-pending");

        expect(isExpectedProfileRestoreStagingPath(userData, expected)).toBe(true);
        expect(isExpectedProfileRestoreStagingPath(userData, path.join(userData, "somewhere-else"))).toBe(false);
        expect(
            isExpectedProfileRestoreStagingPath(userData, path.join(userData, "..", "profile-restore-pending")),
        ).toBe(false);
    });
});

describe("validateExtractedTree", () => {
    it("accepts a normal extracted tree", async () => {
        const root = makeTempDirectory();
        writeFile(path.join(root, "data.db"));
        writeFile(path.join(root, "covers", "page.webp"));
        await expect(validateExtractedTree(root)).resolves.toBeUndefined();
    });

    it.skipIf(process.platform === "win32")("rejects a symbolic link inside the tree", async () => {
        const root = makeTempDirectory();
        const outside = makeTempDirectory();
        writeFile(path.join(outside, "secret.txt"));
        fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));

        await expect(validateExtractedTree(root)).rejects.toThrow(/symbolic link/);
    });
});

describe("profileBackupFileName", () => {
    it("uses the local date in Yopomura-profile-YYYY-MM-DD.zip", () => {
        expect(profileBackupFileName(new Date(2026, 9, 27))).toBe("Yopomura-profile-2026-10-27.zip");
    });
});
