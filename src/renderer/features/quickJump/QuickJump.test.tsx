import { renderWithProviders } from "@test/renderWithProviders";
import { act, fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import QuickJump from "./QuickJump";

vi.mock("./quickJump.scss", () => ({}));

const { navigateToSettingMock, openInReaderMock, openDownloaderMock, openMediaMock, openTrashMock } = vi.hoisted(
    () => ({
        navigateToSettingMock: vi.fn(),
        openInReaderMock: vi.fn(),
        openDownloaderMock: vi.fn(),
        openMediaMock: vi.fn(),
        openTrashMock: vi.fn(),
    }),
);

vi.mock("@renderer/App", () => ({
    useAppContext: () => ({
        openInReader: openInReaderMock,
        openDownloader: openDownloaderMock,
        openMedia: openMediaMock,
        openTrash: openTrashMock,
    }),
}));

vi.mock("@features/settings/utils/navigateToSetting", () => ({
    navigateToSetting: navigateToSettingMock,
}));

describe("QuickJump Component", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("is initially closed", () => {
        const { queryByRole } = renderWithProviders(<QuickJump />);
        expect(queryByRole("dialog")).toBeNull();
    });

    it("opens on Ctrl+K and closes on Escape", () => {
        const { queryByRole } = renderWithProviders(<QuickJump />);

        act(() => {
            window.dispatchEvent(
                new KeyboardEvent("keydown", {
                    key: "k",
                    ctrlKey: true,
                    bubbles: true,
                }),
            );
        });

        expect(screen.getByRole("dialog")).toBeInTheDocument();

        act(() => {
            fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
        });

        expect(queryByRole("dialog")).toBeNull();
    });

    it("opens on yokomura:toggle-quickjump event", () => {
        renderWithProviders(<QuickJump />);

        act(() => {
            window.dispatchEvent(new Event("yokomura:toggle-quickjump"));
        });

        expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("detects URLs and displays Browser / Downloader options", () => {
        renderWithProviders(<QuickJump />);

        act(() => {
            window.dispatchEvent(new Event("yokomura:toggle-quickjump"));
        });

        const input = screen.getByPlaceholderText(/search library/i);
        act(() => {
            fireEvent.change(input, { target: { value: "https://example.com/manga/one-piece" } });
        });

        expect(screen.getByText("Open in Web Browser")).toBeInTheDocument();
        expect(screen.getByText("Download with Downloader")).toBeInTheDocument();

        fireEvent.click(screen.getByText("Download with Downloader"));
        expect(openDownloaderMock).toHaveBeenCalledWith("https://example.com/manga/one-piece");
    });

    it("searches library items and opens them in reader", () => {
        const preloadedState = {
            library: {
                items: {
                    "/path/to/one-piece": {
                        id: 1,
                        link: "/path/to/one-piece",
                        title: "One Piece Adventure",
                        type: "manga" as const,
                        author: "Eiichiro Oda",
                        cover: null,
                        favouritedAt: null,
                        note: null,
                        extra: {},
                        createdAt: new Date(),
                        updatedAt: new Date(),
                        progress: {
                            itemLink: "/path/to/one-piece",
                            chapterName: "Chapter 1",
                            currentPage: 5,
                            chaptersRead: [],
                            totalPages: 20,
                            lastReadAt: new Date(),
                        },
                    },
                },
                metadata: {},
                loading: false,
                error: null,
            },
        };

        renderWithProviders(<QuickJump />, { preloadedState });

        act(() => {
            window.dispatchEvent(new Event("yokomura:toggle-quickjump"));
        });

        const input = screen.getByPlaceholderText(/search library/i);
        act(() => {
            fireEvent.change(input, { target: { value: "One Piece" } });
        });

        const item = screen.getByText("One Piece Adventure");
        expect(item).toBeInTheDocument();

        fireEvent.click(item);
        expect(openInReaderMock).toHaveBeenCalled();
    });

    it("searches settings and invokes navigateToSetting", () => {
        renderWithProviders(<QuickJump />);

        act(() => {
            window.dispatchEvent(new Event("yokomura:toggle-quickjump"));
        });

        const input = screen.getByPlaceholderText(/search library/i);
        act(() => {
            fireEvent.change(input, { target: { value: "theme" } });
        });

        const settingButtons = screen.getAllByRole("button").filter((b) => b.textContent?.includes("Theme"));
        expect(settingButtons.length).toBeGreaterThan(0);

        fireEvent.click(settingButtons[0]);
        expect(navigateToSettingMock).toHaveBeenCalled();
    });

    it("filters results when switching tabs", () => {
        renderWithProviders(<QuickJump />);

        act(() => {
            window.dispatchEvent(new Event("yokomura:toggle-quickjump"));
        });

        const settingsTab = screen.getByRole("button", { name: "Settings" });
        fireEvent.click(settingsTab);
        expect(settingsTab).toHaveClass("active");
    });
});
