import { createRouter, createWebHistory } from "vue-router";
import AgentsView from "../agents/AgentsView.vue";
import ArchiveView from "../archive/ArchiveView.vue";
import BoardView from "../board/BoardView.vue";
import ItemDetailView from "../item/ItemDetailView.vue";
import AgentsSettings from "../settings/agents/AgentsSettings.vue";
import DaemonSettings from "../settings/daemon/DaemonSettings.vue";
import GeneralSettings from "../settings/general/GeneralSettings.vue";
import PlaybooksSettings from "../settings/playbooks/PlaybooksSettings.vue";
import ReposSettings from "../settings/repos/ReposSettings.vue";
import SettingsLayout from "../settings/SettingsLayout.vue";
import ToolsSettings from "../settings/tools/ToolsSettings.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "board", component: BoardView },
    { path: "/items/:id", name: "item", component: ItemDetailView },
    { path: "/agents/:id?", name: "agent", component: AgentsView },
    { path: "/archive", name: "archive", component: ArchiveView },
    {
      path: "/settings",
      component: SettingsLayout,
      children: [
        { path: "", redirect: "/settings/general" },
        { path: "general", name: "settings-general", component: GeneralSettings },
        { path: "repositories", name: "settings-repositories", component: ReposSettings },
        { path: "agents", name: "settings-agents", component: AgentsSettings },
        { path: "playbooks", name: "settings-playbooks", component: PlaybooksSettings },
        { path: "tools", name: "settings-tools", component: ToolsSettings },
        { path: "daemon", name: "settings-daemon", component: DaemonSettings },
      ],
    },
    { path: "/:rest(.*)*", redirect: "/" },
  ],
});
