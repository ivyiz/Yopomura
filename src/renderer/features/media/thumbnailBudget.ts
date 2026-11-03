/**
 * Budget for live `<video>` thumbnail elements.
 *
 * Video thumbnails are expensive to create: mounting one re-reads the container
 * metadata and seeks to the poster frame. Keep the last {@link MAX_CACHED_THUMBNAILS}
 * elements alive so scrolling the playlist never reloads a frame that was already
 * shown, while still bounding memory for very large libraries.
 *
 * Entries are keyed per mounted thumbnail instance (React `useId`), not per path,
 * because the same file can appear in more than one list at once.
 */

/** Maximum number of `<video>` thumbnail elements kept alive. */
export const MAX_CACHED_THUMBNAILS = 64;

type Entry = {
    /** True while the thumbnail is inside the observer margin. */
    visible: boolean;
};

/** Least-recently-used order, oldest first. */
const order: string[] = [];
const entries = new Map<string, Entry>();
const cached = new Set<string>();
const listeners = new Map<string, Set<() => void>>();

const notify = (id: string): void => {
    const callbacks = listeners.get(id);
    if (!callbacks) return;
    for (const callback of callbacks) callback();
};

const touch = (id: string): void => {
    const at = order.indexOf(id);
    if (at >= 0) order.splice(at, 1);
    order.push(id);
};

/**
 * Drops the oldest entries above the budget. Visible thumbnails are skipped while
 * an offscreen candidate exists, so what the user is looking at stays loaded.
 */
const evictOverflow = (): void => {
    while (cached.size > MAX_CACHED_THUMBNAILS) {
        const victim =
            order.find((id) => cached.has(id) && !entries.get(id)?.visible) ?? order.find((id) => cached.has(id));
        if (!victim) return;
        cached.delete(victim);
        const at = order.indexOf(victim);
        if (at >= 0) order.splice(at, 1);
        notify(victim);
    }
};

/**
 * Marks a thumbnail as used. Call when it enters the viewport (first time and after
 * it was evicted). `retainThumbnail` is idempotent and moves the id to the MRU end.
 */
export const retainThumbnail = (id: string, visible = true): void => {
    const entry = entries.get(id);
    if (entry) entry.visible = visible;
    else entries.set(id, { visible });
    cached.add(id);
    touch(id);
    evictOverflow();
};

/** Updates viewport state so eviction prefers offscreen thumbnails. */
export const setThumbnailVisible = (id: string, visible: boolean): void => {
    const entry = entries.get(id);
    if (!entry) return;
    entry.visible = visible;
};

/** True while this thumbnail owns a live `<video>` element. */
export const isThumbnailCached = (id: string): boolean => cached.has(id);

/** Subscribes to eviction/publication for one thumbnail id. */
export const subscribeThumbnail = (id: string, callback: () => void): (() => void) => {
    let callbacks = listeners.get(id);
    if (!callbacks) {
        callbacks = new Set();
        listeners.set(id, callbacks);
    }
    callbacks.add(callback);
    return () => {
        const current = listeners.get(id);
        if (!current) return;
        current.delete(callback);
        if (current.size === 0) listeners.delete(id);
    };
};

/** Drops a thumbnail when its component unmounts so it stops occupying the budget. */
export const releaseThumbnail = (id: string): void => {
    entries.delete(id);
    cached.delete(id);
    listeners.delete(id);
    const at = order.indexOf(id);
    if (at >= 0) order.splice(at, 1);
};

/** Test helper: clears all bookkeeping. */
export const resetThumbnailBudget = (): void => {
    order.length = 0;
    entries.clear();
    cached.clear();
    listeners.clear();
};
