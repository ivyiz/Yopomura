import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRecoveryPath } from "./trashService";

const existsIn =
    (...taken: string[]) =>
    async (candidate: string): Promise<boolean> =>
        taken.map((row) => path.normalize(row)).includes(path.normalize(candidate));

describe("resolveRecoveryPath", () => {
    it("uses the original path when it is free", async () => {
        const original = path.join("C:\\library", "One Piece.zip");
        await expect(resolveRecoveryPath(original, "file", existsIn())).resolves.toBe(original);
    });

    it("keeps both files with a (recovered) suffix", async () => {
        const original = path.join("C:\\library", "One Piece.zip");
        const first = path.join("C:\\library", "One Piece (recovered).zip");
        const second = path.join("C:\\library", "One Piece (recovered 2).zip");

        await expect(resolveRecoveryPath(original, "file", existsIn(original))).resolves.toBe(first);
        await expect(resolveRecoveryPath(original, "file", existsIn(original, first))).resolves.toBe(second);
    });

    it("suffixes folders without an extension", async () => {
        const original = path.join("C:\\library", "Chapter 01");
        await expect(resolveRecoveryPath(original, "folder", existsIn(original))).resolves.toBe(
            path.join("C:\\library", "Chapter 01 (recovered)"),
        );
    });
});
