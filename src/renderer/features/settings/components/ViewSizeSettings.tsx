import { setAppSettings } from "@store/appSettings";
import { useAppDispatch, useAppSelector } from "@store/hooks";
import { useTranslation } from "react-i18next";

/** Cover and title size controls for the Location list and Gallery view. */
const ViewSizeSettings = () => {
    const { t } = useTranslation("settings");
    const dispatch = useAppDispatch();
    const appSettings = useAppSelector((store) => store.appSettings);

    return (
        <div className="settingItem2" id="settings-viewSizes">
            <h3>{t("viewSizes.title")}</h3>
            <div className="desc">{t("viewSizes.desc")}</div>

            <h4>{t("viewSizes.location")}</h4>
            <div className="main row viewSizeRow" id="settings-locationCoverSize">
                <label htmlFor="settings-locationCoverRange">{t("viewSizes.locationCover")}</label>
                <input
                    id="settings-locationCoverRange"
                    type="range"
                    min={48}
                    max={160}
                    step={4}
                    value={appSettings.locationCoverWidth}
                    onChange={(e) => {
                        dispatch(
                            setAppSettings({
                                locationCoverWidth: Number(e.currentTarget.value),
                            }),
                        );
                    }}
                />
                <span className="viewSizeValue">{appSettings.locationCoverWidth}px</span>
            </div>
            <div className="desc">{t("viewSizes.locationCoverDesc")}</div>

            <div className="main row viewSizeRow" id="settings-locationTitleSize">
                <label htmlFor="settings-locationTitleRange">{t("viewSizes.locationTitle")}</label>
                <input
                    id="settings-locationTitleRange"
                    type="range"
                    min={0.85}
                    max={2}
                    step={0.05}
                    value={appSettings.locationTitleFontSize}
                    onChange={(e) => {
                        dispatch(
                            setAppSettings({
                                locationTitleFontSize: Number(e.currentTarget.value),
                            }),
                        );
                    }}
                />
                <span className="viewSizeValue">{appSettings.locationTitleFontSize.toFixed(2)}rem</span>
            </div>
            <div className="desc">{t("viewSizes.locationTitleDesc")}</div>

            <h4>{t("viewSizes.gallery")}</h4>
            <div className="main row viewSizeRow" id="settings-galleryCoverSize">
                <label htmlFor="settings-galleryCoverRange">{t("viewSizes.galleryCover")}</label>
                <input
                    id="settings-galleryCoverRange"
                    type="range"
                    min={10}
                    max={30}
                    step={1}
                    value={appSettings.galleryItemWidth}
                    onChange={(e) => {
                        dispatch(
                            setAppSettings({
                                galleryItemWidth: Number(e.currentTarget.value),
                            }),
                        );
                    }}
                />
                <span className="viewSizeValue">{appSettings.galleryItemWidth}em</span>
            </div>
            <div className="desc">{t("viewSizes.galleryCoverDesc")}</div>

            <div className="main row viewSizeRow" id="settings-galleryListCoverSize">
                <label htmlFor="settings-galleryListCoverRange">{t("viewSizes.galleryListCover")}</label>
                <input
                    id="settings-galleryListCoverRange"
                    type="range"
                    min={48}
                    max={160}
                    step={4}
                    value={appSettings.galleryListCoverWidth}
                    onChange={(e) => {
                        dispatch(
                            setAppSettings({
                                galleryListCoverWidth: Number(e.currentTarget.value),
                            }),
                        );
                    }}
                />
                <span className="viewSizeValue">{appSettings.galleryListCoverWidth}px</span>
            </div>
            <div className="desc">{t("viewSizes.galleryListCoverDesc")}</div>

            <div className="main row viewSizeRow" id="settings-galleryTitleSize">
                <label htmlFor="settings-galleryTitleRange">{t("viewSizes.galleryTitle")}</label>
                <input
                    id="settings-galleryTitleRange"
                    type="range"
                    min={0.8}
                    max={2}
                    step={0.05}
                    value={appSettings.galleryTitleFontSize}
                    onChange={(e) => {
                        dispatch(
                            setAppSettings({
                                galleryTitleFontSize: Number(e.currentTarget.value),
                            }),
                        );
                    }}
                />
                <span className="viewSizeValue">{appSettings.galleryTitleFontSize.toFixed(2)}rem</span>
            </div>
            <div className="desc">{t("viewSizes.galleryTitleDesc")}</div>

            <div className="main row">
                <button
                    onClick={() => {
                        dispatch(
                            setAppSettings({
                                locationCoverWidth: 80,
                                locationTitleFontSize: 1.12,
                                galleryItemWidth: 16,
                                galleryTitleFontSize: 1,
                                galleryListCoverWidth: 56,
                            }),
                        );
                    }}
                >
                    {t("shared.reset")}
                </button>
            </div>
        </div>
    );
};

export default ViewSizeSettings;
