<script setup lang="ts">
import type { PlaybookEntry } from "../../api/types";
import MarkdownView from "../../markdown/MarkdownView.vue";
import { matchText, sourceText } from "./describe";

/** One playbook's full content, read-only (issue #154). Editing happens in the file. */
defineProps<{ playbook: PlaybookEntry }>();
</script>

<template>
  <div class="pb-detail">
    <dl class="kv">
      <dt>File</dt>
      <dd class="mono" style="overflow-wrap: anywhere">{{ playbook.file }}</dd>
      <dt>Source</dt>
      <dd>{{ sourceText(playbook) }}</dd>
      <dt>Fits</dt>
      <dd>{{ matchText(playbook.match) }}</dd>
      <dt>Model</dt>
      <dd class="mono">{{ playbook.model }}<template v-if="playbook.effort"> · effort {{ playbook.effort }}</template></dd>
      <dt>Permission mode</dt>
      <dd class="mono">{{ playbook.permissionMode }}</dd>
      <dt>Access</dt>
      <dd>
        <template v-if="playbook.readOnly">Read only: no file edits, no web access, only the user's own Claude settings load</template>
        <template v-else>Edits files in its worktree</template>
      </dd>
      <dt>Draft tools</dt>
      <dd>
        <div class="row" style="gap: 4px; flex-wrap: wrap">
          <span v-for="t in playbook.tools" :key="t" class="badge mono">{{ t }}</span>
        </div>
      </dd>
      <dt>Allowed without asking</dt>
      <dd>
        <div class="row" style="gap: 4px; flex-wrap: wrap">
          <span v-for="r in playbook.permissions.allow" :key="r" class="badge mono ok">{{ r }}</span>
        </div>
      </dd>
      <dt>Always denied</dt>
      <dd>
        <div class="row" style="gap: 4px; flex-wrap: wrap">
          <span v-for="r in playbook.permissions.deny" :key="r" class="badge mono danger">{{ r }}</span>
        </div>
      </dd>
    </dl>
    <h3>Prompt</h3>
    <p class="sub">The first message the agent gets. Placeholders like <span class="mono" v-pre>{{ title }}</span> are filled in per item.</p>
    <div class="prompt"><MarkdownView :source="playbook.body" /></div>
  </div>
</template>

<style scoped>
.pb-detail { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.pb-detail h3 { margin: 8px 0 0; font-size: 13px; font-weight: 600; }
.pb-detail .sub { margin: 0; }
.prompt { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; max-height: 480px; overflow: auto; }
@media (max-width: 640px) {
  .pb-detail .kv { grid-template-columns: minmax(0, 1fr); }
}
</style>
