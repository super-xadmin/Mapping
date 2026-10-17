import "leaflet/dist/leaflet.css";
// ฟอนต์เดียวกับเว็บ super-x.tech (เก็บไฟล์ไว้ในเว็บเอง ใช้ได้แม้ออฟไลน์)
import "@fontsource/poppins/400.css";
import "@fontsource/poppins/500.css";
import "@fontsource/poppins/600.css";
import "@fontsource/poppins/700.css";
import "@fontsource/prompt/400.css";
import "@fontsource/prompt/500.css";
import "@fontsource/prompt/600.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import App from "./App";
import { startSyncLoop } from "./lib/outbox";
import { recorder } from "./lib/recorder";

startSyncLoop();
recorder.init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// ติดตั้งเป็นแอปบนมือถือได้ และเปิดหน้าเว็บได้แม้ไม่มีสัญญาณ
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
