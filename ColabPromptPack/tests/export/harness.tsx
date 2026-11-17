import { createRoot } from "react-dom/client";
import { NotebookExport } from "../../src/components/NotebookExport";
import * as exportUtils from "../../src/utils/notebookExport";
import { exportNotebook } from "./fixture";
import type { IFileSystem } from "../../src/services/FileSystem";

Object.assign(window, { exportUtils, exportNotebook, violations: [] });
window.addEventListener("securitypolicyviolation", event => (window as any).violations.push({ directive: event.violatedDirective, uri: event.blockedURI }));
window.addEventListener("message", event => {
  if (event.data?.type === "PROMPTPACK_EXPORT_NOTEBOOK") window.postMessage({ type: "PROMPTPACK_EXPORT_NOTEBOOK_RESULT", requestId: event.data.requestId, payload: { notebook: (window as any).exportNotebook, title: "Assignment.ipynb" } }, "*");
});
createRoot(document.getElementById("root")!).render(<NotebookExport fs={{} as IFileSystem} disabled={false} />);
