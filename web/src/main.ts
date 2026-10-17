import { mount } from "svelte";
import App from "./App.svelte";
import "./assets/fonts/fonts.css";
import "./app.css";

export default mount(App, { target: document.getElementById("app")! });
