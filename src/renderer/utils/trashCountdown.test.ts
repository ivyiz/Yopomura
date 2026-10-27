import { describe, expect, it } from "vitest";
import { getTrashCountdown, TRASH_DAY_MS, TRASH_HOUR_MS, TRASH_MINUTE_MS } from "./trashCountdown";

describe("getTrashCountdown", () => {
    const now = 1_700_000_000_000;

    it("returns null for legacy entries without an expiry", () => {
        expect(getTrashCountdown(undefined, now)).toBeNull();
        expect(getTrashCountdown(Number.NaN, now)).toBeNull();
    });

    it("reports an expired entry", () => {
        expect(getTrashCountdown(now - 1, now)).toEqual({
            expired: true,
            days: 0,
            hours: 0,
            minutes: 0,
        });
        expect(getTrashCountdown(now, now)?.expired).toBe(true);
    });

    it("buckets days, hours and minutes", () => {
        const threeDays = now + 3 * TRASH_DAY_MS + 5 * TRASH_HOUR_MS + 2 * TRASH_MINUTE_MS;
        expect(getTrashCountdown(threeDays, now)).toEqual({
            expired: false,
            days: 3,
            hours: 5,
            minutes: 2,
        });

        const hours = now + 4 * TRASH_HOUR_MS + 30 * TRASH_MINUTE_MS;
        expect(getTrashCountdown(hours, now)).toEqual({
            expired: false,
            days: 0,
            hours: 4,
            minutes: 30,
        });

        const minutes = now + 90 * 1000;
        expect(getTrashCountdown(minutes, now)).toEqual({
            expired: false,
            days: 0,
            hours: 0,
            minutes: 2,
        });
    });

    it("rounds partial minutes up so a live item is never shown as zero", () => {
        expect(getTrashCountdown(now + 1, now)?.minutes).toBe(1);
        expect(getTrashCountdown(now + TRASH_MINUTE_MS + 1, now)?.minutes).toBe(2);
    });
});
