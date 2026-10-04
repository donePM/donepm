import { createRouter, createWebHistory } from "vue-router";
import AgentsView from "../agents/AgentsView.vue";
import ArchiveView from "../archive/ArchiveView.vue";
import BoardView from "../board/BoardView.vue";
import ItemDetailView from "../item/ItemDetailView.vue";
import SettingsView from "../settings/SettingsView.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "board", component: BoardView },
    { path: "/items/:id", name: "item", component: ItemDetailView },
    { path: "/agents/:id?", name: "agent", component: AgentsView },
    { path: "/archive", name: "archive", component: ArchiveView },
    { path: "/settings", name: "settings", component: SettingsView },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
});
