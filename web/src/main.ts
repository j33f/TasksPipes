import { mount } from "svelte";
import App from "./App.svelte";
import { registerServiceWorker } from "./lib/push";
import "./assets/fonts/fonts.css";
import "./app.css";

export default mount(App, { target: document.getElementById("app")! });

registerServiceWorker();
