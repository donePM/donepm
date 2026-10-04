<script setup lang="ts">
import { status } from "../../status/status";
import { useNow } from "../../time/now";
import { ago } from "../../time/relative";
import { settings } from "../store";
import OrphansPanel from "./OrphansPanel.vue";
import ReposTable from "./ReposTable.vue";
import UnclonedPanel from "./UnclonedPanel.vue";

const now = useNow();
</script>

<template>
  <div>
    <h1>Repositories</h1>
    <p class="lead">
      Found under <span class="mono">{{ settings?.repoRoot ?? "…" }}</span>, depth 4<template v-if="status?.lastScan"> · scanned {{ ago(status.lastScan, now) }}</template>.
      Items come from each repository's own query; ignored repositories stay off the board.
    </p>
  </div>
  <ReposTable />
  <UnclonedPanel />
  <OrphansPanel />
</template>
