# PromptPack Colab — review submission notes

Draft for updating the existing Chrome Web Store item `piniclchmidgfainpldphnocipgilmll`.

## Package

- Candidate version: **1.0.5** (the public listing showed 1.0.4 when prepared).
- Upload: `../PromptPackerColab-chrome.zip`. The ZIP contains `manifest.json` at its root.
- The developer dashboard may contain a newer draft or another submission; check its status and version before uploading.

## Suggested listing description

PromptPack Colab helps you work with AI in Google Colab. Select notebook cells, copy formatted context, and compare changes. Agent Terminal lets you use an installed coding agent alongside your notebook through PromptPack Bridge, a companion app running on your computer. Ask the agent to edit, add, move, or delete cells; saved edits sync to the open notebook. You can also request a cell run and inspect available output.

Agent Terminal requires an editable Google Colab notebook, PromptPack Bridge, and a separately installed and signed-in coding agent. The current Bridge downloads are unsigned previews, so your operating system may show an installation warning. The prompt-packing features can be used without Bridge.

## Suggested instructions for reviewers

1. Open an editable notebook at https://colab.research.google.com/ and open PromptPack Colab.
2. Use the main view to select notebook cells and generate or copy context.
3. To exercise Agent Terminal, install and open PromptPack Bridge from https://github.com/ClarkOhlenbusch/PromptPacker/releases/tag/bridge-v0.2.2 and install and sign in to a compatible coding agent separately.
4. In PromptPack, choose **Agent Terminal**, select the installed agent, and click **Start session**. Ask the agent to add a comment to a cell. Its normal approval prompts apply, and saved changes are synchronized to the notebook.
5. A connected Colab runtime is needed to exercise code execution. A queued run does not on its own prove execution completed.

## Privacy and permissions facts for the dashboard

Verify these against the existing listing, privacy policy, and actual product behavior before submitting. The dashboard's declarations and any published policy must be accurate; these notes are not a completed privacy declaration.

- The extension reads the content of the user's open Google Colab notebook to offer notebook context and synchronize cells.
- PromptPack Bridge communicates with the extension on localhost. When a user starts an agent session, notebook cell content is copied into a temporary local workspace and the chosen agent can access it. The agent may send content to its provider under that provider's terms and settings. The bridge cleans up the workspace when the session ends; unexpected termination can leave temporary files behind.
- The extension uses Chrome storage for settings, clipboard access when the user copies content, and scripting/Colab host access for notebook integration. Localhost access connects to Bridge. It also requests public GitHub release information to find Bridge installers.
- The app must accurately disclose the data it handles and where it can go. Google requires a privacy policy for products that handle user data, including when processing happens locally. The publisher must verify the policy URL and dashboard declarations, including any newly required permission justifications.

## Submission

Upload the package to the existing item, update the listing and privacy practices as necessary, and submit for review. For review without automatic publication after approval, select the dashboard's deferred publishing option or the API's `STAGED_PUBLISH` mode. Google decides the outcome and can request additional information.
