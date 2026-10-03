import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "./theme.css";
import { createApp } from "vue";
import App from "./shell/App.vue";
import { router } from "./shell/router";

createApp(App).use(router).mount("#app");
