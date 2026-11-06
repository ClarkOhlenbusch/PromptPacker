# PromptPack Bridge

The companion app that connects PromptPack's Agent Terminal to a coding agent on your computer.

## Install and use

1. Check [Bridge releases](https://github.com/ClarkOhlenbusch/PromptPacker/releases?q=bridge-v&expanded=true) for an installer. **No public Bridge installer has been published yet.** Until one is available, use the development instructions below to build a preview.
2. Install and open it:
   - **Mac:** open the universal `.dmg`, drag PromptPack Bridge to Applications, then open it. The same download supports Apple silicon and Intel Macs.
   - **Windows:** open `Setup.exe`. It installs for your user account and opens Bridge when finished. Use x64 for most PCs; an arm64 build is available for Windows on ARM.
   - **Linux:** install the `.deb` on Debian/Ubuntu, or download the `.AppImage`. For an AppImage, allow it to run as a program in your file manager's Properties/Permissions, then open it. Use arm64 on ARM computers and x64 on Intel/AMD computers.
3. When the app says **Ready for Colab**, open an editable Colab notebook, open PromptPack, select **Agent Terminal**, and click **Start session**. The current Agent Terminal requires the [extension preview](https://github.com/ClarkOhlenbusch/PromptPacker/raw/refs/heads/main/PromptPackerColab-chrome.zip); unzip it and load the folder containing `manifest.json` through Chrome's `chrome://extensions` page with Developer mode enabled.

Bridge includes its own runtime and native terminal support. **You do not need to install Node.js, Python, or run commands to start Bridge.**

Your coding agent is installed separately. The app checks for Codex and Claude Code and offers their official setup guides when needed. Sign in to your chosen agent when its terminal opens. Other installed CLI agents can be used with **Custom CLI**.

Closing the window keeps Bridge running in the menu bar or system tray on Mac/Windows. On Linux, keep it open or minimized. Use **Quit Bridge** to stop it. Mac and Windows users can optionally enable **Open Bridge when I sign in**.

Once installed, the extension's **Open Bridge** link can launch it through `promptpack-bridge://open` on systems where the installer registered the protocol.

> Distribution status: local packages are development previews until signing/notarization is configured and a Bridge release is published. The extension never substitutes the unrelated PromptPack Lite editor download when no Bridge release is available.

## Develop the bridge

```sh
npm ci
npm start
```

To run the desktop companion during development:

```sh
npm run desktop
```

The native terminal uses `node-pty` on macOS, Windows, and Linux. On Unix, the command-line development server can fall back to the legacy Python relay if the native module cannot load. The desktop app requires its bundled native terminal; it never requires a system Python installation.

### Checks

```sh
npm test
npm run desktop:smoke
```

The desktop smoke test starts an isolated bridge on a random port, checks native terminal output, verifies the setup window says **Ready for Colab**, and exits. It uses a temporary profile and does not change login items or protocol registration.

To smoke-test a packaged app, run its executable with `--smoke-test`. On Linux CI, use Xvfb and pass `--no-sandbox` for the test container only.

For the extension-to-bridge workflow, run `node scripts/verify-agent-workflow.cjs` from `ColabPromptPack`. It tests Bridge setup/discovery, automatic sync, hidden-panel persistence, and conflicts in an isolated Chrome profile using a dummy agent and fixture notebook.

Run `node scripts/verify-colab-cell-creation.cjs` from that directory to test code and Markdown creation against the **real Colab frontend**. It uses a signed-out browser and the unsaved local copy of Google's public welcome notebook. It checks automatic append, replay without duplication, editing after reordering, and export/reload/re-import followed by another edit. It never writes a Drive notebook; cloud save persistence needs a signed-in manual check.

### Build installers

```sh
npm run dist -- --mac --universal
npm run dist -- --win --x64
npm run dist -- --linux --x64
```

Outputs are written to `release/`. Mac packaging uses architecture-specific native terminal prebuilds inside a universal app. Build Linux native dependencies on Linux; do not copy `node_modules` from a Mac or Windows machine.

The [Bridge packaging workflow](../.github/workflows/bridge-release.yml) builds Mac universal, Windows x64/arm64, and Linux x64/arm64 installers on their respective platforms. It tests the source and packaged native terminal, adds checksums, and uploads reviewable artifacts. A `bridge-v<version>` tag creates a **draft** release, not an automatic public release. The package version and tag must match.

For a local unsigned Mac preview:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist -- --mac --universal -c.mac.notarize=false
```

For reproducible Linux builds in Docker, `scripts/Dockerfile.linux` supplies native build and graphical smoke-test dependencies. Mount a separate Linux source checkout at `/work` so Linux native modules do not overwrite your host's modules.

### Public release signing

For smooth public installation, configure these repository secrets before publishing:

- **Mac:** `MAC_CSC_LINK` and `MAC_CSC_KEY_PASSWORD` for a Developer ID Application certificate; `APPLE_API_KEY_CONTENT`, `APPLE_API_KEY_ID`, and `APPLE_API_ISSUER` for notarization.
- **Windows:** `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` for the Windows signing certificate.

An Apple Development certificate is not a substitute for Developer ID distribution. Unsigned preview builds may show operating-system warnings and are not the intended nontechnical-user installation experience. See [Electron's distribution guidance](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging).

Publish the reviewed, signed draft as a stable `bridge-v*` release. The extension discovers that release and selects the appropriate installer; it ignores editor releases, drafts, and prereleases. Publishing the companion does not replace the editor's latest release.

## Connection and execution

- Local endpoint: `ws://127.0.0.1:47123`.
- Health and installed-agent detection: `http://127.0.0.1:47123/health`.
- Saved agent edits sync automatically; the agent retains its usual approval settings.
- New `.py` and `.md` files in `notebook/new_cells/` append code and Markdown cells to Colab. Continue editing the same file to update the new cell.
- Failed/partially applied edits retain their local files and per-cell baselines for retry.
- Session reconnect restores buffered terminal output and outstanding edits.
- Ordinary website WebSocket origins are rejected. Chrome extension origins and local non-browser clients are supported.

Advanced developer overrides: `PROMPTPACK_BRIDGE_PORT` changes the listening port and `PROMPTPACK_BRIDGE_TOKEN` enables shared-secret authentication for custom clients. Standard extension/desktop setup uses the default local connection.

### Adding notebook cells

Ask your agent to add a final cell. New sessions include `AGENTS.md` and `CLAUDE.md` instructions explaining the workflow, so the agent can create, for example:

```text
notebook/new_cells/01_prediction_maps.py
notebook/new_cells/02_explanation.md
```

Each file becomes one cell at the end of the open notebook after its contents settle for a few seconds. Files discovered together append in filename order. The file stays mapped to a persistent Colab cell ID, including after reordering or reloading the notebook. Retries reuse the same ID, preventing duplicate cells. Colab uses its normal edit/undo/save path.

Cell creation requires an editable notebook and the current extension **and** Bridge. Restart Bridge, reload the extension, refresh Colab, and start a fresh agent session after updating. Older sessions do not contain the new agent instructions.

Creating a separate `.ipynb` does not import cells. To insert a cell elsewhere, the agent creates it and then moves it before or after another cell. It can also delete a cell and request a run or inspect its output. These commands are described in the automatically generated agent instructions; a command returns a result file in the session workspace. Cell type conversion is not supported. A queued run is not proof that execution completed, and runtime prompts or unavailable runtimes can prevent execution.

New cell files remain intact if Colab is read-only or sync fails; resolve the issue and use **Retry sync** under Notebook changes. Discarding an unsynced creation stops importing that file and leaves it on disk for recovery until the session ends.

## Notebook checks

Run the bridge tests with `npm test` in `promptpack-bridge`. Run `npm run build` and `npx vitest run` in `ColabPromptPack` for the extension checks. These cover sync conflicts, new cells, stable IDs, reconnects, structural changes, command failures, and execution request handling. Run `node scripts/verify-agent-workflow.cjs` in `ColabPromptPack` to check the extension, terminal, and sync together against a fixture notebook and dummy agent.

`node scripts/verify-colab-cell-creation.cjs` from `ColabPromptPack` runs a separate canary against the real Colab frontend. It uses a fresh signed-out Chrome profile and verifies that the public example notebook is not saveable before changing its local copy. It checks creation, replay, edits after moving and reloading, move, delete, and output inspection. It does not start a connected runtime, verify code execution, or verify Google Drive saving. A network outage or Colab frontend change can cause a canary failure; inspect the logs and screenshot before treating a failure as a product regression.

The `Notebook checks and Colab canary` GitHub Actions workflow runs the deterministic checks for relevant pull requests. The live canary runs weekly and can be started manually after the workflow is present on the repository's default branch. It retains available screenshots and the exported temporary notebook for seven days.
