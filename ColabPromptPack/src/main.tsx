import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initializeFileSystem } from "./services/FileSystem";
import { ColabFileSystem } from "./services/ColabFileSystem";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Initialize the appropriate file system
initializeFileSystem(new ColabFileSystem());

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
