import type { I18nChangedPayload, I18nState, LanguageSource } from "@common/i18n";
import type { KeymapEditIpcResult, KeymapEditOp, KeymapSnapshot, NativeKeymapAction } from "@common/keybindings";
import type { MainSettingsType } from "@common/mainSettings";
import type {
    BrowserAdblockState,
    BrowserBounds,
    BrowserContextMenuRequest,
    BrowserDownload,
    BrowserScannedLink,
    BrowserSearchEngine,
    BrowserState,
} from "@common/types/browser";
import type { AddDownloaderJobInput, DownloaderJob, DownloaderState } from "@common/types/downloader";
import type {
    LibraryScanStartRequest,
    LibraryScanStartResult,
    LibraryScanStatus,
} from "@common/types/libraryScan";
import type { ProxyConfig, ProxySaveResult, ProxyState, ProxyTestResult } from "@common/types/network";
import type {
    PurgeTrashResult,
    RestoreTrashResult,
    TrashEntry,
    TrashEntryKind,
    TrashItemType,
} from "@common/types/trash";
import type {
    AddBookBookmarkData,
    AddBookNoteData,
    AddMangaBookmarkData,
    AddToLibraryData,
    BookBookmark,
    BookNote,
    BookProgress,
    CreateLibraryTagData,
    DeleteLibraryTagData,
    ItemTracker,
    LibraryItem,
    LibraryItemMetadata,
    LibraryItemTag,
    LibraryItemWithProgress,
    LibraryTag,
    MangaBookmark,
    MangaProgress,
    RemoveItemTrackerData,
    SetLibraryItemMetadataData,
    SetLibraryItemTagsData,
    UnionLibraryItemTagsData,
    UpdateBookBookmarkData,
    UpdateBookProgressData,
    UpdateLibraryItemData,
    UpdateLibraryTagData,
    UpdateMangaBookmarkData,
    UpdateMangaProgressData,
    UpdateTrackerSnapshotData,
    UpsertItemTrackerData,
} from "./db";

/**
 * m2r: main to renderer
 * r2m: renderer to main
 */
type ChannelDefinition<Req = unknown, Res = unknown, Dir extends "m2r" | "r2m" = "r2m"> = {
    request: Req;
    response: Res;
    direction: Dir;
    // [K: string]: K extends "request" | "response" ? any : never;
};

// todo: move types beside their implementation as .d.ts

/**
 * Shared result shape for all `covers:*` IPC channels and the main-process helpers that back them.
 */
export type CoverOpResult = { ok: true } | { ok: false; message: string };

/** Result for path-keyed cover previews; `filePath` is an absolute WebP path. */
export type CoverPreviewResult = { ok: true; filePath: string } | { ok: false; message: string };

export type CoverChannels = {
    "covers:materialize": ChannelDefinition<{ libraryId: number; sourceAbsolutePath: string }, CoverOpResult>;
    /** Claims the process-wide renderer canvas slot for one lazy PDF thumbnail. */
    "covers:acquirePdfRender": ChannelDefinition<{ libraryId: number }, boolean>;
    /** Releases a PDF thumbnail canvas slot after the claiming renderer finishes or abandons it. */
    "covers:releasePdfRender": ChannelDefinition<{ libraryId: number }, void>;
    /** Resolves a folder/archive/EPUB source in main, then materializes its managed thumbnail. */
    "covers:materializeFromLibraryPath": ChannelDefinition<
        { libraryId: number; itemType: "manga" | "book"; link: string },
        CoverOpResult
    >;
    "covers:deleteForLibraryId": ChannelDefinition<{ libraryId: number }, CoverOpResult>;
    /**
     * Writes the tracker cover slot from an http(s) image URL or a percent-encoded `data:` URL.
     * Does not replace the library thumbnail.
     */
    "covers:materializeFromUrl": ChannelDefinition<{ libraryId: number; url: string }, CoverOpResult>;
    /** Removes all files under `userData/covers` and recreates the directory. */
    "covers:clearCache": ChannelDefinition<void, CoverOpResult>;
    /**
     * Materializes a small cached WebP for any manga file/folder path, keyed by path + mtime + size.
     * Used by list views that show covers before an item exists in the library catalogue.
     */
    "covers:previewForPath": ChannelDefinition<{ path: string }, CoverPreviewResult>;
    /**
     * Once per process: true when migration 0001 ran this launch and this window may show the
     * post-upgrade generate-thumbnails prompt. Other windows get false.
     *
     * todo(remove-after-0001-prompt): delete with the post-0001 thumbnail prompt flow.
     */
    "covers:claimPost0001ThumbnailPrompt": ChannelDefinition<void, boolean>;
};

export type LibraryScanChannels = {
    "libraryScan:start": ChannelDefinition<LibraryScanStartRequest, LibraryScanStartResult>;
    "libraryScan:cancel": ChannelDefinition<void, void>;
    "libraryScan:getStatus": ChannelDefinition<void, LibraryScanStatus | null>;
    "libraryScan:rendererReady": ChannelDefinition<void, void>;
    "libraryScan:status": ChannelDefinition<LibraryScanStatus | null, void, "m2r">;
    "anilist:claimLegacyTrackingImport": ChannelDefinition<void, boolean>;
};

export type DatabaseChannels = {
    "db:library:getItem": ChannelDefinition<{ link: string }, LibraryItem | null>;
    "db:library:getAllAndProgress": ChannelDefinition<void, LibraryItemWithProgress[]>;
    "db:library:addItem": ChannelDefinition<AddToLibraryData, LibraryItem>;
    "db:library:updateItem": ChannelDefinition<UpdateLibraryItemData, LibraryItem | null>;
    "db:library:deleteItem": ChannelDefinition<{ link: string }, boolean>;
    /** Drops progress rows for the given catalogue links; library items stay. */
    "db:library:deleteProgressForLinks": ChannelDefinition<{ links: string[] }, { deleted: number }>;
    /** Move a library item to a new disk path; updates FK `itemLink` columns. Returns null on conflict/missing. */
    "db:library:relocateItem": ChannelDefinition<{ oldLink: string; newLink: string }, LibraryItem | null>;
    "db:library:getAllBookmarks": ChannelDefinition<
        void,
        {
            mangaBookmarks: MangaBookmark[];
            bookBookmarks: BookBookmark[];
        }
    >;
    "db:manga:getProgress": ChannelDefinition<{ itemLink: string }, MangaProgress | null>;
    "db:manga:updateProgress": ChannelDefinition<UpdateMangaProgressData, MangaProgress | null>;
    "db:manga:updateChaptersRead": ChannelDefinition<
        { itemLink: string; chapterName: string; read: boolean },
        string[]
    >;
    "db:manga:updateChaptersReadAll": ChannelDefinition<
        { itemLink: string; chapters: string[]; read: boolean },
        string[]
    >;
    "db:manga:getBookmarks": ChannelDefinition<{ itemLink: string }, MangaBookmark[]>;
    "db:manga:addBookmark": ChannelDefinition<AddMangaBookmarkData, MangaBookmark | null>;
    "db:manga:updateBookmark": ChannelDefinition<UpdateMangaBookmarkData, MangaBookmark | null>;
    "db:manga:deleteBookmarks": ChannelDefinition<{ itemLink: string; ids: number[]; all?: boolean }, boolean>;
    "db:book:getProgress": ChannelDefinition<{ itemLink: string }, BookProgress | null>;
    "db:book:updateProgress": ChannelDefinition<UpdateBookProgressData, BookProgress | null>;
    "db:book:getBookmarks": ChannelDefinition<{ itemLink: string }, BookBookmark[]>;
    "db:book:addBookmark": ChannelDefinition<AddBookBookmarkData, BookBookmark | null>;
    "db:book:updateBookmark": ChannelDefinition<UpdateBookBookmarkData, BookBookmark | null>;
    "db:book:deleteBookmarks": ChannelDefinition<{ itemLink: string; ids: number[]; all?: boolean }, boolean>;
    "db:book:getAllNotes": ChannelDefinition<void, BookNote[]>;
    "db:book:getNotes": ChannelDefinition<{ itemLink: string }, BookNote[]>;
    "db:book:addNote": ChannelDefinition<AddBookNoteData, BookNote | null>;
    "db:book:updateNote": ChannelDefinition<{ id: number; content: string; color?: string }, BookNote | null>;
    "db:book:deleteNotes": ChannelDefinition<{ itemLink: string; ids: number[]; all?: boolean }, boolean>;

    "db:trackers:getAll": ChannelDefinition<void, ItemTracker[]>;
    "db:trackers:upsert": ChannelDefinition<UpsertItemTrackerData, ItemTracker | null>;
    "db:trackers:remove": ChannelDefinition<RemoveItemTrackerData, boolean>;
    "db:trackers:updateSnapshot": ChannelDefinition<UpdateTrackerSnapshotData, ItemTracker | null>;
    "db:library:getAllMetadata": ChannelDefinition<void, LibraryItemMetadata[]>;
    "db:library:setMetadata": ChannelDefinition<SetLibraryItemMetadataData, LibraryItemMetadata | null>;
    "db:tags:getAll": ChannelDefinition<void, LibraryTag[]>;
    "db:tags:create": ChannelDefinition<CreateLibraryTagData, LibraryTag | null>;
    "db:tags:update": ChannelDefinition<UpdateLibraryTagData, LibraryTag | null>;
    "db:tags:delete": ChannelDefinition<DeleteLibraryTagData, boolean>;
    "db:library:getAllItemTags": ChannelDefinition<void, LibraryItemTag[]>;
    "db:library:setItemTags": ChannelDefinition<SetLibraryItemTagsData, LibraryItemTag[] | null>;
    "db:library:unionItemTags": ChannelDefinition<UnionLibraryItemTagsData, LibraryItemTag[] | null>;

    //
    "db:library:reset": ChannelDefinition<void, boolean>;
};

// ! for updating store only, temp only
export type DatabaseChangeChannels = {
    "db:library:change": ChannelDefinition<void, void, "m2r">;
    "db:bookmark:change": ChannelDefinition<void, void, "m2r">;
    "db:bookNote:change": ChannelDefinition<void, void, "m2r">;
    "db:tracker:change": ChannelDefinition<void, void, "m2r">;
    "db:tag:change": ChannelDefinition<void, void, "m2r">;
};

export type WindowManagementChannels = {
    "window:openLinkInNewWindow": ChannelDefinition<string, void>;
    "window:destroy": ChannelDefinition<void, void>;
    "window:addDirToDelete": ChannelDefinition<string, void>;
    /**
     * for checking if window opened and loaded App without crashing
     */
    "window:statusCheck": ChannelDefinition<void, void, "m2r">;
    "window:statusCheck:response": ChannelDefinition<void, void, "r2m">;
};

export type ClipboardChannels = {
    "clipboard:readText": ChannelDefinition<void, string>;
    "clipboard:writeText": ChannelDefinition<{ text: string }, void>;
    /**
     * Writes one PNG to the clipboard. `imagePath` is a filesystem image.
     * `pngBytes` is already-encoded PNG data, such as a canvas export.
     */
    "clipboard:copyImage": ChannelDefinition<{ imagePath: string } | { pngBytes: Uint8Array }, void>;
};

export type FileSystemChannels = {
    "fs:unzip": ChannelDefinition<
        { source: string; destination: string },
        | { source: string; destination: string; ok: true }
        | {
              ok: false;
              message: string;
          }
    >;
    "fs:showInExplorer": ChannelDefinition<string, void>;
    /** Moves one file/folder into the app trash and starts its retention countdown. */
    "fs:trashItem": ChannelDefinition<
        {
            path: string;
            kind?: TrashEntryKind;
            title?: string;
            itemType?: TrashItemType;
            /** Days to keep the item; defaults to 7. */
            retentionDays?: number;
        },
        { ok: true; entry: TrashEntry } | { ok: false; message: string }
    >;
    "fs:saveFile": ChannelDefinition<{ filePath: string; data: string }, void>;
    "fs:fileChanged": ChannelDefinition<{ filePath: string; sourceWindowId?: number; ts: number }, void, "m2r">;
};

export type AppUpdateChannel = "stable" | "beta";

export type UpdateChannels = {
    "update:check:manual": ChannelDefinition<
        {
            promptAfterCheck?: boolean;
            channel?: AppUpdateChannel;
        },
        void
    >;
};

export type ExplorerMenuChannels = {
    "explorer:addOption": ChannelDefinition<void, boolean>;
    "explorer:removeOption": ChannelDefinition<void, boolean>;
    "explorer:addOption:epub": ChannelDefinition<void, boolean>;
    "explorer:removeOption:epub": ChannelDefinition<void, boolean>;
};

export type ReaderChannels = {
    "reader:loadLink": ChannelDefinition<{ link: string }, void, "m2r">;
    "reader:recordPage": ChannelDefinition<void, void, "m2r">;
};

export type DialogChannels = {
    "dialog:error": ChannelDefinition<
        {
            title?: string;
            message: string;
            detail?: string;
            log?: boolean;
        },
        Electron.MessageBoxReturnValue
    >;

    "dialog:warn": ChannelDefinition<
        {
            title?: string;
            message: string;
            detail?: string;
            noOption?: boolean;
            buttons?: string[];
            defaultId?: number;
            cancelId?: number;
        },
        Electron.MessageBoxReturnValue
    >;

    "dialog:confirm": ChannelDefinition<
        {
            title?: string;
            message: string;
            detail?: string;
            noOption?: boolean;
            buttons?: string[];
            defaultId?: number;
            cancelId?: number;
            checkboxLabel?: string;
            type?: "info" | "warning" | "error" | "question";
            noLink?: boolean;
        },
        Electron.MessageBoxReturnValue
    >;

    "dialog:nodeError": ChannelDefinition<
        {
            name: string;
            errno: number | undefined;
            message: string;
        },
        Electron.MessageBoxReturnValue
    >;

    "dialog:showOpenDialog": ChannelDefinition<Electron.OpenDialogOptions, Electron.OpenDialogReturnValue>;
    "dialog:showSaveDialog": ChannelDefinition<Electron.SaveDialogOptions, Electron.SaveDialogReturnValue>;
};

export type ErrorReportingChannels = {
    "error:report": ChannelDefinition<
        {
            error: string;
            stack?: string;
            context?: Record<string, unknown>;
            severity?: "low" | "medium" | "high" | "critical";
        },
        void
    >;
};

export type MainSettingsChannels = {
    "mainSettings:get": ChannelDefinition<void, MainSettingsType>;
    "mainSettings:update": ChannelDefinition<Partial<MainSettingsType>, void>;
    "mainSettings:sync": ChannelDefinition<MainSettingsType, void, "m2r">;
};

export type DbBackupListItem = {
    fileName: string;
    createdAtMs: number;
    byteSize: number;
};

/** {@link MainSettingsType.dbBackup} plus whether a backup is currently running. */
export type DbBackupStatus = MainSettingsType["dbBackup"] & {
    isBackingUp: boolean;
};

export type DbBackupRestoreErrorCode = "invalidName" | "notFound";

export type DbBackupImportErrorCode = "notFound" | "integrityFailed" | "copyFailed";

export type DbBackupChannels = {
    "dbBackup:getStatus": ChannelDefinition<void, DbBackupStatus>;
    "dbBackup:list": ChannelDefinition<void, DbBackupListItem[]>;
    "dbBackup:runNow": ChannelDefinition<void, { ok: boolean }>;
    "dbBackup:restore": ChannelDefinition<
        { fileName: string },
        { ok: true } | { ok: false; code: DbBackupRestoreErrorCode }
    >;
    "dbBackup:importAndRestore": ChannelDefinition<
        { absolutePath: string },
        { ok: true } | { ok: false; code: DbBackupImportErrorCode; reason?: string }
    >;
};

export type I18nChannels = {
    "i18n:getState": ChannelDefinition<void, I18nState>;
    "i18n:listSources": ChannelDefinition<void, LanguageSource[]>;
    "i18n:setSource": ChannelDefinition<{ sourceId: string }, I18nState>;
    "i18n:installPack": ChannelDefinition<
        { archivePath: string },
        { ok: true; source: LanguageSource } | { ok: false; message: string }
    >;
    "i18n:removePack": ChannelDefinition<{ packId: string }, { ok: true } | { ok: false; message: string }>;
    "i18n:exportPack": ChannelDefinition<
        { sourceId: string; destinationPath: string },
        { ok: true } | { ok: false; message: string }
    >;
    "i18n:changed": ChannelDefinition<I18nChangedPayload, void, "m2r">;
};

export type KeymapChangedPayload = {
    snapshot: KeymapSnapshot;
    /** BrowserWindow id that submitted the edit; null for non-edit broadcasts. */
    originWindowId: number | null;
};

export type KeymapChannels = {
    "keymap:get": ChannelDefinition<void, KeymapSnapshot>;
    "keymap:edit": ChannelDefinition<KeymapEditOp, KeymapEditIpcResult>;
    "keymap:changed": ChannelDefinition<KeymapChangedPayload, void, "m2r">;
    "keymap:nativeAction": ChannelDefinition<{ action: NativeKeymapAction }, void>;
};

export type DownloaderChannels = {
    "downloader:getState": ChannelDefinition<void, DownloaderState>;
    "downloader:add": ChannelDefinition<AddDownloaderJobInput, DownloaderJob>;
    "downloader:cancel": ChannelDefinition<{ id: string }, void>;
    "downloader:remove": ChannelDefinition<{ id: string }, void>;
    "downloader:clearFinished": ChannelDefinition<void, void>;
    /** Pauses the active job and the queue without losing progress. */
    "downloader:pause": ChannelDefinition<void, void>;
    /** Resumes a paused worker. */
    "downloader:resume": ChannelDefinition<void, void>;
    "downloader:state": ChannelDefinition<DownloaderState, void, "m2r">;
};

export type TrashChannels = {
    "trash:list": ChannelDefinition<{ limit?: number }, TrashEntry[]>;
    "trash:recover": ChannelDefinition<{ id: string }, RestoreTrashResult>;
    /** Permanently removes an app-trash entry. */
    "trash:delete": ChannelDefinition<{ id: string }, PurgeTrashResult>;
    /** Drops a legacy Recycle Bin journal row without touching the file. */
    "trash:forget": ChannelDefinition<{ id: string }, boolean>;
    "trash:openFolder": ChannelDefinition<void, void>;
    "trash:purgeExpired": ChannelDefinition<void, number>;
    /** Permanently removes every pending app-trash entry. */
    "trash:empty": ChannelDefinition<void, { ok: true; count: number } | { ok: false; message: string }>;
    /** Count and on-disk size of the pending app trash. */
    "trash:stats": ChannelDefinition<void, { count: number; totalBytes: number }>;
    /** Sets a per-item retention window and recomputes its expiry. */
    "trash:setRetention": ChannelDefinition<
        { id: string; days: number },
        { ok: true; entry: TrashEntry } | { ok: false; message: string }
    >;
    /** Recovers every pending entry, keeping both files on name collisions. */
    "trash:restoreAll": ChannelDefinition<
        void,
        { ok: true; count: number; failed: number } | { ok: false; message: string }
    >;
};

export type BrowserChannels = {
    "browser:getState": ChannelDefinition<void, BrowserState>;
    "browser:createTab": ChannelDefinition<{ url?: string; activate?: boolean }, { id: string }>;
    "browser:closeTab": ChannelDefinition<{ id: string }, boolean>;
    "browser:activateTab": ChannelDefinition<{ id: string }, boolean>;
    "browser:navigate": ChannelDefinition<{ id: string; input: string }, boolean>;
    "browser:back": ChannelDefinition<{ id?: string }, boolean>;
    "browser:forward": ChannelDefinition<{ id?: string }, boolean>;
    "browser:reload": ChannelDefinition<{ id?: string }, boolean>;
    "browser:stop": ChannelDefinition<{ id?: string }, boolean>;
    "browser:setBounds": ChannelDefinition<BrowserBounds, void>;
    "browser:setVisible": ChannelDefinition<{ visible: boolean }, void>;
    "browser:setForceDark": ChannelDefinition<{ enabled: boolean }, void>;
    "browser:setHostForceDark": ChannelDefinition<{ hostOrUrl: string; enabled: boolean }, boolean>;
    "browser:getDisabledHosts": ChannelDefinition<void, string[]>;
    "browser:setSearchEngine": ChannelDefinition<{ engine: BrowserSearchEngine }, void>;
    "browser:setDownloadDir": ChannelDefinition<{ dir: string | null }, void>;
    /** Extracts http(s) links from the active/requested tab. */
    "browser:scanLinks": ChannelDefinition<{ tabId?: string }, BrowserScannedLink[]>;
    "browser:getAdblock": ChannelDefinition<void, BrowserAdblockState>;
    "browser:setAdblock": ChannelDefinition<{ enabled: boolean }, BrowserAdblockState>;
    /** Cached data URLs for the New Tab site tiles. */
    "browser:getSiteIcons": ChannelDefinition<{ hosts: string[] }, Record<string, string>>;
    "browser:state": ChannelDefinition<BrowserState, void, "m2r">;
    "browser:download": ChannelDefinition<BrowserDownload, void, "m2r">;
    "browser:contextMenu": ChannelDefinition<BrowserContextMenuRequest, void, "m2r">;
};

export type ProfileBackupChannels = {
    /** Prompts for a destination and writes a complete profile ZIP. */
    "profileBackup:create": ChannelDefinition<
        void,
        { ok: true; path: string; bytes: number } | { ok: false; message: string }
    >;
    /**
     * Prompts for a profile ZIP, stages it for the next launch and asks the
     * renderer to tell the user a restart is required.
     */
    "profileBackup:restore": ChannelDefinition<
        void,
        { ok: true; restartRequired: boolean; message?: string } | { ok: false; message: string }
    >;
};

export type NetworkChannels = {
    "network:getProxy": ChannelDefinition<void, ProxyState>;
    "network:setProxy": ChannelDefinition<{ config: Partial<ProxyConfig>; password?: string }, ProxySaveResult>;
    "network:testProxy": ChannelDefinition<{ config: Partial<ProxyConfig>; password?: string }, ProxyTestResult>;
};

export type IPCChannels = DatabaseChannels &
    DatabaseChangeChannels &
    WindowManagementChannels &
    ClipboardChannels &
    FileSystemChannels &
    UpdateChannels &
    ExplorerMenuChannels &
    ReaderChannels &
    DialogChannels &
    ErrorReportingChannels &
    MainSettingsChannels &
    DbBackupChannels &
    CoverChannels &
    LibraryScanChannels &
    I18nChannels &
    KeymapChannels &
    DownloaderChannels &
    TrashChannels &
    BrowserChannels &
    ProfileBackupChannels &
    NetworkChannels;

export type MainToRendererChannels = {
    [K in keyof IPCChannels as IPCChannels[K] extends ChannelDefinition<unknown, unknown, "m2r">
        ? K
        : never]: IPCChannels[K];
};

export type RendererToMainChannels = {
    [K in keyof IPCChannels as IPCChannels[K] extends ChannelDefinition<unknown, unknown, "r2m">
        ? K
        : never]: IPCChannels[K];
};
