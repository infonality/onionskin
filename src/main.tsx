import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "katex/dist/katex.min.css";
import "./styles/base.css";
import "./styles/themes.css";
import "./styles/shell.css";
import "./styles/editor.css";

// The desktop shell should never behave like a web page: App.tsx opens the
// application's own context menu instead. Shift+right-click falls through to
// the webview's native menu, which is the only place spelling suggestions live.
document.addEventListener("contextmenu", (event) => {
  if (!event.shiftKey) event.preventDefault();
});

window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
