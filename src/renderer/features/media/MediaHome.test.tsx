import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MediaHome, { type MediaHomeProps } from "./MediaHome";
import type { VideoEntry } from "./mediaLibrary";

const entry = (path: string, title: string): VideoEntry => ({
    path,
    title,
    sizeBytes: 1024,
    modifiedMs: 1,
});

const baseProps = (): MediaHomeProps => ({
    scanning: false,
    scanNote: "",
    onCancelScan: vi.fn(),
    continueItems: [],
    recentlyDownloaded: [],
    recentFolders: [],
    customRoot: "",
    onSelectVideo: vi.fn(),
    onOpenFolder: vi.fn(),
    onChooseFolder: vi.fn(),
    onUseLibrary: vi.fn(),
});

describe("MediaHome", () => {
    it("orders recent folders, add card, downloads, continue, then the drop zone", () => {
        const props = baseProps();
        const continueEntry = entry("C:\\Shows\\Ep1.mp4", "Ep 1");
        props.continueItems = [
            {
                entry: continueEntry,
                position: { path: continueEntry.path, time: 30, duration: 600, updatedAt: 1 },
            },
        ];
        props.recentlyDownloaded = [{ entry: entry("C:\\Videos\\clip.webm", "clip"), downloadedAt: 2 }];
        props.recentFolders = [{ path: "C:\\Shows\\Anime", openedAt: 5 }];

        render(<MediaHome {...props} />);

        const nodes = [
            screen.getByText("Recent Folders"),
            screen.getByText("Add videos"),
            screen.getByText("Recently Downloaded"),
            screen.getByText("Continue Playing"),
            screen.getByText("Drop videos here"),
        ];
        for (let index = 1; index < nodes.length; index += 1) {
            const previous = nodes[index - 1];
            const current = nodes[index];
            expect(previous.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }

        expect(screen.queryByText("Recently Played")).not.toBeInTheDocument();
        expect(screen.queryByText("Clear")).not.toBeInTheDocument();
    });

    it("opens folders and chooses a new folder", () => {
        const props = baseProps();
        props.recentFolders = [{ path: "C:\\Shows\\Anime", openedAt: 5 }];
        render(<MediaHome {...props} />);

        fireEvent.click(screen.getByText("Anime"));
        expect(props.onOpenFolder).toHaveBeenCalledWith("C:\\Shows\\Anime");

        fireEvent.click(screen.getByText("Choose folder"));
        expect(props.onChooseFolder).toHaveBeenCalledTimes(1);
    });

    it("keeps the add card and drop zone when there is no history", () => {
        render(<MediaHome {...baseProps()} />);

        expect(screen.getByText("Add videos")).toBeInTheDocument();
        expect(screen.getByText("Drop videos here")).toBeInTheDocument();
        expect(screen.queryByText("Recent Folders")).not.toBeInTheDocument();
        expect(screen.queryByText("Continue Playing")).not.toBeInTheDocument();
    });
});
