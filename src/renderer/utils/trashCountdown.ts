/** Remaining time before a Recently Deleted entry is permanently removed. */
export type TrashCountdown = {
    expired: boolean;
    /** Whole days left (0 when less than a day remains). */
    days: number;
    /** Whole hours left after removing days. */
    hours: number;
    /** Whole minutes left after removing hours. */
    minutes: number;
};

export const TRASH_MINUTE_MS = 60_000;
export const TRASH_HOUR_MS = 60 * TRASH_MINUTE_MS;
export const TRASH_DAY_MS = 24 * TRASH_HOUR_MS;

/**
 * Buckets the remaining milliseconds into days/hours/minutes. Rounds up so an
 * item never reads "0 minutes" while it still exists.
 */
export const getTrashCountdown = (expiresAt: number | undefined, now = Date.now()): TrashCountdown | null => {
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;

    const remaining = expiresAt - now;
    if (remaining <= 0) return { expired: true, days: 0, hours: 0, minutes: 0 };

    const totalMinutes = Math.ceil(remaining / TRASH_MINUTE_MS);
    return {
        expired: false,
        days: Math.floor(totalMinutes / (24 * 60)),
        hours: Math.floor((totalMinutes % (24 * 60)) / 60),
        minutes: totalMinutes % 60,
    };
};
