export type PageEvictionHandler = (pageIndex: number) => void;
export type PageReloadHandler = (pageIndex: number) => void;

export interface MangaPageLRUOptions {
    maxCapacity: number;
    onEvict?: PageEvictionHandler;
    onReload?: PageReloadHandler;
}

export class MangaPageLRUCache {
    private maxCapacity: number;
    private accessOrder: number[] = [];
    private cachedPages = new Set<number>();
    private evictedPages = new Set<number>();
    private visiblePages = new Set<number>();
    private onEvict?: PageEvictionHandler;
    private onReload?: PageReloadHandler;

    constructor(options: MangaPageLRUOptions) {
        this.maxCapacity = Math.max(20, Math.min(200, options.maxCapacity));
        this.onEvict = options.onEvict;
        this.onReload = options.onReload;
    }

    setMaxCapacity(capacity: number): void {
        this.maxCapacity = Math.max(20, Math.min(200, capacity));
        this.evictOverflow();
    }

    getMaxCapacity(): number {
        return this.maxCapacity;
    }

    getCachedCount(): number {
        return this.cachedPages.size;
    }

    getCachedPages(): number[] {
        return Array.from(this.cachedPages);
    }

    isCached(pageIndex: number): boolean {
        return this.cachedPages.has(pageIndex);
    }

    isEvicted(pageIndex: number): boolean {
        return this.evictedPages.has(pageIndex);
    }

    isVisible(pageIndex: number): boolean {
        return this.visiblePages.has(pageIndex);
    }

    setVisible(pageIndex: number, visible: boolean): void {
        if (visible) {
            this.visiblePages.add(pageIndex);
            this.touch(pageIndex);
        } else {
            this.visiblePages.delete(pageIndex);
        }
    }

    touch(pageIndex: number): void {
        const wasEvicted = this.evictedPages.has(pageIndex);
        if (wasEvicted) {
            this.evictedPages.delete(pageIndex);
        }

        const idx = this.accessOrder.indexOf(pageIndex);
        if (idx >= 0) {
            this.accessOrder.splice(idx, 1);
        }
        this.accessOrder.push(pageIndex);
        this.cachedPages.add(pageIndex);

        if (wasEvicted && this.onReload) {
            this.onReload(pageIndex);
        }

        this.evictOverflow();
    }

    registerInitial(pageIndex: number): void {
        if (!this.cachedPages.has(pageIndex)) {
            this.cachedPages.add(pageIndex);
            this.accessOrder.push(pageIndex);
        }
        this.evictOverflow();
    }

    evictOverflow(): number[] {
        const evicted: number[] = [];
        while (this.cachedPages.size > this.maxCapacity) {
            const victim =
                this.accessOrder.find((p) => this.cachedPages.has(p) && !this.visiblePages.has(p)) ??
                this.accessOrder.find((p) => this.cachedPages.has(p));

            if (victim === undefined) break;

            this.cachedPages.delete(victim);
            this.evictedPages.add(victim);
            const idx = this.accessOrder.indexOf(victim);
            if (idx >= 0) {
                this.accessOrder.splice(idx, 1);
            }

            evicted.push(victim);
            if (this.onEvict) {
                this.onEvict(victim);
            }
        }
        return evicted;
    }

    evictPage(pageIndex: number): boolean {
        if (!this.cachedPages.has(pageIndex)) return false;
        this.cachedPages.delete(pageIndex);
        this.evictedPages.add(pageIndex);
        const idx = this.accessOrder.indexOf(pageIndex);
        if (idx >= 0) {
            this.accessOrder.splice(idx, 1);
        }
        if (this.onEvict) {
            this.onEvict(pageIndex);
        }
        return true;
    }

    clear(): void {
        this.accessOrder = [];
        this.cachedPages.clear();
        this.evictedPages.clear();
        this.visiblePages.clear();
    }
}
