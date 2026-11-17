# Notebook export validation

Run `npm test -- --run` for unit tests. Run `npx playwright install chromium` once, then `npm run test:export` to build the extension and run browser checks. The export suite loads a temporary Manifest V3 extension with Chrome's actual default extension CSP. It requires no Google account. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` optionally selects an existing compatible Chromium executable.

The browser suite checks:

- DataFrame table formatting and removal of Colab-only table toolbar controls.
- CSS-based scikit-learn diagrams and accessible disclosure controls, including CSS comments containing HTML tag names.
- SVG colors, clipping, equations, and saved image dimensions.
- Native .ipynb data preservation and output/Markdown filtering without mutating the snapshot.
- Standalone HTML with isolated output styles and no executable notebook handlers.
- Markdown tables, saved images, and text representations of styled diagrams.
- PDF output after delayed images load, and a visible error when an image cannot load.
- Embedding reachable public images and keeping linked images when embedding fails.

Screenshots, a downloaded HTML sample, and a PDF are written to the ignored `export-test-results` directory. The native serialization test also covers asynchronous Colab serializers and preservation of metadata and MIME bundles.

## Fidelity boundaries

The .ipynb export preserves the selected native notebook JSON. HTML and PDF render saved static representations. JavaScript-only widgets need a saved image, SVG, HTML, or text representation; conversion does not rerun notebook code or a Colab runtime. Optional Colab table conversion/chart suggestion controls are removed while the underlying table is retained. CSS-only diagram controls continue to work in HTML.

Markdown supports ordinary tables and embedded saved images. It uses the text representation of CSS-styled pipeline diagrams. Markdown viewers differ in their support for embedded image data URLs. HTML/PDF are the formats for styled visual submissions. Linked images that cannot be embedded may still need network access.

## Latest local validation

- Build passed; 63 unit tests and 7 Chromium extension browser tests passed.
- Inspected the supplied `pipelines_example` HTML and Markdown exports. Reconstructed their saved cell outputs and restored the standard scikit-learn 1.6.1 diagram CSS for a targeted comparison. Confirmed the DataFrame's six rows (header plus five data rows), both pipeline diagrams, and the saved plot. This was a comparison using exported content, not a readback of the live notebook.
- Targeted comparison produced no export warnings or browser console errors. Review artifacts are in `/tmp/promptpack-export-validation` for this session.
