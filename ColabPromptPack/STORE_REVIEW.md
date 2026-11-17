# PromptPack Colab — review submission notes

Draft for updating the existing Chrome Web Store item `piniclchmidgfainpldphnocipgilmll`.

## Package

- Candidate version: **1.0.7**, including notebook export. Confirm that it is newer than every published or pending version in the dashboard before uploading.
- Upload: `../PromptPackerColab-chrome.zip`. The ZIP contains `manifest.json` at its root.
- The developer dashboard may contain a newer draft or another submission; check its status and version before uploading.

## Suggested listing description

PromptPack Colab helps you work with AI in Google Colab. Select notebook cells, copy formatted context, and compare changes. Agent Terminal lets you use an installed coding agent alongside your notebook through PromptPack Bridge, a companion app running on your computer. Ask the agent to edit, add, move, or delete cells; saved edits sync to the open notebook. You can also request a cell run and inspect available output.

Export your notebook as .ipynb, HTML, Markdown, or Python, or save a PDF through the print dialog. Choose whether to include outputs and Markdown cells. HTML and PDF preserve saved tables, images, SVG charts, equations, and styled static outputs. Markdown includes tables and saved images; Python includes text outputs. Outputs that require a running Colab session need a saved static representation for HTML or PDF. The .ipynb file preserves the selected native notebook data.

Agent Terminal requires an editable Google Colab notebook, PromptPack Bridge, and a separately installed and signed-in coding agent. The current Bridge downloads are unsigned previews, so your operating system may show an installation warning. The prompt-packing features can be used without Bridge.

## Suggested instructions for reviewers

1. Open an editable notebook at https://colab.research.google.com/ and open PromptPack Colab.
2. Use the main view to select notebook cells and generate or copy context.
3. To exercise Agent Terminal, install and open PromptPack Bridge from https://github.com/ClarkOhlenbusch/PromptPacker/releases/tag/bridge-v0.2.2 and install and sign in to a compatible coding agent separately.
4. In PromptPack, choose **Agent Terminal**, select the installed agent, and click **Start session**. Ask the agent to add a comment to a cell. Its normal approval prompts apply, and saved changes are synchronized to the notebook.
5. Click **Export notebook**. Confirm that the preview shows saved tables, images, and any pipeline diagrams. Toggle **Outputs** and **Markdown cells**, then download HTML, Markdown, Python, or .ipynb, or choose **PDF (print)**. A runtime is not required to export saved outputs.
6. A connected Colab runtime is needed to exercise code execution. A queued run does not on its own prove execution completed.

## Privacy and permissions facts for the dashboard

Verify these against the existing listing, privacy policy, and actual product behavior before submitting. The dashboard's declarations and any published policy must be accurate; these notes are not a completed privacy declaration.

- The extension reads the content of the user's open Google Colab notebook to offer notebook context and synchronize cells.
- PromptPack Bridge communicates with the extension on localhost. When a user starts an agent session, notebook cell content is copied into a temporary local workspace and the chosen agent can access it. The agent may send content to its provider under that provider's terms and settings. The bridge cleans up the workspace when the session ends; unexpected termination can leave temporary files behind.
- The extension uses Chrome storage for settings, clipboard access when the user copies content, and scripting/Colab host access for notebook integration. Localhost access connects to Bridge. It also requests public GitHub release information to find Bridge installers.
- Notebook conversion runs locally. When preparing an export, public image URLs in notebook content may be requested without credentials so images can be embedded. Images that cannot be embedded retain their original URLs and may require network access when viewing the export. No new extension permissions are requested for export.
- The app must accurately disclose the data it handles and where it can go. Google requires a privacy policy for products that handle user data, including when processing happens locally. The publisher must verify the policy URL and dashboard declarations, including any newly required permission justifications.

## Submission

Version **1.0.7** was uploaded to the existing item and submitted for review, replacing the pending 1.0.6 submission. The dashboard shows **Pending review**, with automatic publication after approval enabled. The export description and reviewer instructions were updated and verified by reloading the dashboard; extension permissions and existing privacy declarations were unchanged.

- Verified at: `2026-11-07T15:22:01.936Z`
- Package SHA-256: `229be68ffbd81e6dc2e5380f664f7ddbeb20e7497d2aa43d25b847d3abf2c533`
- Submission screenshot: `/tmp/promptpack-store-1.0.7-submitted.png`
- Receipt: `/tmp/promptpack-store-1.0.7-receipt.json`

Google decides the review outcome and publication timing.
