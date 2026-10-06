# Third-party software and fonts

All runtime code and font files are bundled locally by `npm run build`. No CDN or
font service is used by the application.

| Component | Version | Purpose | Licence |
| --- | --- | --- | --- |
| [PDF.js](https://github.com/mozilla/pdf.js) (`pdfjs-dist`) | 6.4.299 | Browser PDF parsing and rendering | Apache-2.0; [notice](licenses/PDFjs-Apache-2.0.txt) |
| [Atkinson Hyperlegible](https://github.com/googlefonts/atkinson-hyperlegible) (`@fontsource/atkinson-hyperlegible`) | 5.3.0 | Reader font | OFL-1.1; [notice](licenses/Atkinson-Hyperlegible-OFL.txt) |
| [Lexend](https://github.com/googlefonts/lexend) (`@fontsource/lexend`) | 5.3.0 | Reader font | OFL-1.1; [notice](licenses/Lexend-OFL.txt) |
| [OpenDyslexic](https://github.com/antijingoist/opendyslexic) | Official repository `main` compiled WOFF2 files downloaded 6 October 2026 | Reader font | OFL-1.1; [notice](licenses/OpenDyslexic-OFL.txt) |
| [Vite](https://github.com/vitejs/vite) | 7.3.6 | Build tool, not a runtime network service | MIT and bundled dependency notices; [notice](licenses/Vite-MIT.txt) |

The `package-lock.json` pins the full dependency tree. OpenDyslexic WOFF2
files are committed under `public/fonts/`; Atkinson and Lexend are copied into
the static build from their local npm packages. The font notices must remain
with redistributed builds.
