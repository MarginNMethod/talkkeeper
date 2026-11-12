import React from "react";
import ReactDOM from "react-dom/client";
import { DictationIndicator, DictationNotice } from "./Dictation";
import { App } from "./App";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {new URLSearchParams(location.search).has("dictation") ? (
      <DictationIndicator />
    ) : (
      <>
        <DictationNotice />
        <App />
      </>
    )}
  </React.StrictMode>,
);
