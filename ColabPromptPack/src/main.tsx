import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeFileSystem } from "./services/FileSystem";
import { ColabFileSystem } from "./services/ColabFileSystem";

// Initialize the appropriate file system
initializeFileSystem(new ColabFileSystem());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
