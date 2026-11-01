import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { applyAccent, savedAccent } from "./theme.ts";

applyAccent(savedAccent());

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
