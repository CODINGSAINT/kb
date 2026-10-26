# KB · Coding Saint design

The website and the local learning workspace share `public/brand.css`, loaded after the existing component styles. It implements the same identity as codingsaint.com without changing the study data model or AI, sync and payment interfaces.

- Manrope is bundled under `public/vendor/fonts/` with its SIL OFL license. Code uses the existing local JetBrains Mono font. No font request leaves the device.
- Light: white ground, #0B0D12 ink, #5A5F6B muted ink, #F4F3EF raised surfaces, #E2E0DA borders.
- Dark: #0B0D12 ground, white ink, #A0A6B0 muted ink, #16191F raised surfaces, #262A33 borders.
- Indigo Dusk: #1F1A4D with white and #B9B4E0 text. The #C81E3A bindu is reserved for the brand mark.
- Theme follows the operating system until the visitor explicitly chooses light or dark. The existing `kb-theme` preference is retained. Editors and diagrams update alongside the page.
- The launch page explains learning through practice. Its sample feedback is explicitly illustrative. Topic content remains unchanged.
- `node build/make-site.js` builds the public site, including fonts, app icons and the versioned offline cache. Keep its personal-data checks intact.

Verification: production static build and privacy scan; JavaScript syntax checks; desktop and 390px mobile views; theme persistence; topic navigation; isolated answer editing, saving and reloading; editor dark theme.
