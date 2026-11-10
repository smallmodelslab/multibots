import "@/features/ui/ui.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ToastProvider } from "@/features/shell/Toasts";
import { TooltipProvider } from "@/features/ui/tooltip";
import { App } from "./App";

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
