import type { TrashEntry } from "@common/types/trash";
import { useAppContext } from "@renderer/App";
import { useAppDispatch } from "@store/hooks";
import { recoverTrashEntry } from "@utils/trash";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./trashToast.scss";

/** Bottom-right undo toast fed by the `yokomura:trashed` browser event. */
const TrashToast = () => {
    const { t } = useTranslation("common");
    const dispatch = useAppDispatch();
    const { openTrash } = useAppContext();
    const [entry, setEntry] = useState<TrashEntry | null>(null);
    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const timerRef = useRef<number>(0);
    const dismiss = () => {
        window.clearTimeout(timerRef.current);
        setEntry(null);
        setMessage("");
    };

    useEffect(() => {
        const onTrashed = (event: Event) => {
            const detail = (event as CustomEvent<TrashEntry>).detail;
            if (!detail) return;
            window.clearTimeout(timerRef.current);
            setEntry(detail);
            setMessage("");
            timerRef.current = window.setTimeout(() => {
                setEntry(null);
            }, 10000);
        };
        window.addEventListener("yokomura:trashed", onTrashed);
        return () => {
            window.removeEventListener("yokomura:trashed", onTrashed);
            window.clearTimeout(timerRef.current);
        };
    }, []);

    if (!entry) return null;

    const undo = async () => {
        setBusy(true);
        const result = await recoverTrashEntry(dispatch, entry);
        setBusy(false);
        if (result.ok) {
            setMessage(t("contextMenu.undoRestored", { defaultValue: "Restored" }));
            window.setTimeout(dismiss, 1400);
        } else {
            setMessage(result.message);
        }
    };

    const view = () => {
        openTrash();
        dismiss();
    };

    return (
        <output className="trashToast">
            <div className="trashToastBody">
                <strong>{t("contextMenu.moveToTrashDone", { defaultValue: "Moved to Recently Deleted" })}</strong>
                <span title={entry.originalPath}>{entry.name}</span>
                {message ? <em>{message}</em> : null}
            </div>
            <div className="trashToastActions">
                <button type="button" onClick={() => void undo()} disabled={busy}>
                    {t("contextMenu.undo", { defaultValue: "Undo" })}
                </button>
                <button type="button" onClick={view}>
                    {t("contextMenu.viewTrash", { defaultValue: "View" })}
                </button>
                <button type="button" className="trashToastClose" onClick={dismiss} aria-label="Close">
                    ×
                </button>
            </div>
        </output>
    );
};

export default TrashToast;
