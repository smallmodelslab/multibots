import "@/features/ui/ui.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { serializeError } from "@wrkrsh/client-log";

import { ToastProvider } from "@/features/shell/Toasts";
import { TooltipProvider } from "@/features/ui/tooltip";
import { App } from "./App";

// What fails in the window that nothing catches goes to the log and analytics.
window.addEventListener("error", (event) =>
  window.openbots.reportError(serializeError(event.error ?? event.message)),
);
window.addEventListener("unhandledrejection", (event) =>
  window.openbots.reportError(serializeError(event.reason)),
);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element.");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider delay={400}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </TooltipProvider>
  </StrictMode>,
);
