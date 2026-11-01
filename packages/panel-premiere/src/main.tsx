import { createRoot } from "react-dom/client";
import cssText from "../public/styles.css?inline";
import { App } from "./App.tsx";
import { applyAccent, savedAccent } from "./theme.ts";
import { tryLoadUpdate } from "./update/loader.ts";

async function boot() {
  // Если скачано обновление новее встроенной версии — запускаем его вместо себя.
  if (await tryLoadUpdate()) return;

  // Загруженное обновление приносит свои стили (у встроенной версии они уже подключены в index.html).
  if ((window as any).__paUpdateLoaded) {
    const style = document.createElement("style");
    style.textContent = cssText;
    document.head.appendChild(style);
  }

  applyAccent(savedAccent());
  const container = document.getElementById("root");
  if (container) createRoot(container).render(<App />);
}

void boot();
