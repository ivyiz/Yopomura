import "./styles.scss";
import V2App from "@features/v2";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { toggleSettingsOpen } from "@store/ui";
import { useTranslation } from "react-i18next";
import ClassicView from "./classic/ClassicView";
import GalleryView from "./gallery/GalleryView";

const HomeView: React.FC = () => {
    /* kick off lazy `home` namespace load for classic/gallery children */
    useTranslation("home");
    const dispatch = useAppDispatch();
    const viewMode = useAppSelector((store) => store.appSettings.homeViewMode);
    const isReaderActive = useAppSelector((store) => store.reader.active);

    return (
        <div
            className="homeContainer"
            style={{
                display: isReaderActive ? "none" : "flex",
            }}
        >
            {viewMode === "classic" ? (
                <ClassicView />
            ) : viewMode === "v2" ? (
                <V2App onOpenSettings={() => dispatch(toggleSettingsOpen())} />
            ) : (
                <GalleryView />
            )}
        </div>
    );
};

export default HomeView;
