import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";
// iOS ignores user-scalable=no, so block the zoom gesture directly (the play area sets touch-action:none).
addEventListener("gesturestart", (e) => e.preventDefault());
mount(App, { target: document.getElementById("app")! });
