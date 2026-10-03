import { createRouter, createWebHistory } from "vue-router";
import BoardView from "../board/BoardView.vue";
import SettingsView from "../settings/SettingsView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "board", component: BoardView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
});
