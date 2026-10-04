import { createRouter, createWebHistory } from "vue-router";
import BoardView from "../board/BoardView.vue";

// The board is the landing view; every other view loads on first visit.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "board", component: BoardView },
    { path: "/items/:id", name: "item", component: () => import("../item/ItemDetailView.vue") },
    { path: "/agents/:id?", name: "agent", component: () => import("../agents/AgentsView.vue") },
    { path: "/archive", name: "archive", component: () => import("../archive/ArchiveView.vue") },
    {
      path: "/settings",
      component: () => import("../settings/SettingsLayout.vue"),
      children: [
        { path: "", redirect: "/settings/general" },
        { path: "general", name: "settings-general", component: () => import("../settings/general/GeneralSettings.vue") },
        { path: "repositories", name: "settings-repositories", component: () => import("../settings/repos/ReposSettings.vue") },
        { path: "agents", name: "settings-agents", component: () => import("../settings/agents/AgentsSettings.vue") },
        { path: "playbooks", name: "settings-playbooks", component: () => import("../settings/playbooks/PlaybooksSettings.vue") },
        { path: "tools", name: "settings-tools", component: () => import("../settings/tools/ToolsSettings.vue") },
        { path: "daemon", name: "settings-daemon", component: () => import("../settings/daemon/DaemonSettings.vue") },
      ],
    },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
});
