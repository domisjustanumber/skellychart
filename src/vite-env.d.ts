/// <reference types="vite/client" />

interface ImportMetaEnv {
    /** Set in GitHub Actions so printed-chart QR codes point at this repo's GitHub Pages site. */
    readonly VITE_CHARUCO_PRINT_SOURCE_URL?: string;
}
