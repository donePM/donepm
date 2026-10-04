<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../../api/client";
import { errorText } from "../../api/errors";
import type { PlaybookEntry, PlaybookList } from "../../api/types";
import IconBook from "../../icons/IconBook.vue";
import IconFolder from "../../icons/IconFolder.vue";
import { originText } from "./describe";
import PlaybookDetail from "./PlaybookDetail.vue";

const list = ref<PlaybookList>();
const error = ref<string>();
const opening = ref(false);
/** The file of the playbook whose content is open below its row (#154). */
const viewing = ref<string>();

onMounted(async () => {
  try {
    list.value = await api.playbooks();
  } catch (e) {
    error.value = errorText(e);
  }
});

async function openFolder() {
  opening.value = true;
  error.value = undefined;
  try {
    await api.openDaemon("playbooks");
  } catch (e) {
    error.value = errorText(e);
  } finally {
    opening.value = false;
  }
}

const fileName = (path: string) => path.split("/").at(-1) ?? path;
const toggle = (p: PlaybookEntry) => (viewing.value = viewing.value === p.file ? undefined : p.file);
</script>

<template>
  <div>
    <h1>Playbooks</h1>
    <p class="lead">
      How an agent works on an item: model, effort, permission mode and the drafts it may write. Global playbooks live in
      <span class="mono">{{ list?.globalDir ?? "…" }}</span>; a repository's own in its <span class="mono">.donepm/playbooks</span> replace a global one of the same name there.
      View shows a playbook's prompt and what its agent may do; editing happens in the files.
    </p>
  </div>

  <section class="card">
    <div class="row" style="padding: 12px 14px; border-bottom: 1px solid var(--border)">
      <span class="row" style="gap: 8px; font-weight: 600"><IconBook />{{ list ? `${list.playbooks.length} playbooks` : "Playbooks" }}</span>
      <button class="btn sm" type="button" style="margin-left: auto" :disabled="opening" @click="openFolder"><IconFolder class="ic-sm" />Open folder</button>
    </div>
    <p v-if="error" class="alert" role="alert" style="margin: 12px 14px">{{ error }}</p>
    <div v-if="list?.playbooks.length" style="overflow-x: auto">
      <table class="tbl" style="min-width: 760px">
        <thead><tr><th>Name</th><th>Model</th><th>Effort</th><th>Permission mode</th><th>Drafts</th><th>Origin</th><th><span class="sr">View</span></th></tr></thead>
        <tbody>
          <template v-for="p in list.playbooks" :key="p.file">
            <tr>
              <td><div style="font-weight: 500">{{ p.name }}</div><div class="mono" style="color: var(--fg-3)" :title="p.file">{{ fileName(p.file) }}</div></td>
              <td class="mono">{{ p.model }}</td>
              <td class="mono">{{ p.effort ?? "—" }}</td>
              <td class="mono">{{ p.permissionMode }}</td>
              <td>
                <div class="row" style="gap: 4px">
                  <span v-for="d in p.drafts" :key="d" class="badge">{{ d }}</span>
                  <span v-if="p.readOnly" class="badge muted">read only</span>
                  <span v-if="!p.drafts.length && !p.readOnly" class="sub">—</span>
                </div>
              </td>
              <td>
                <span :class="p.scope.kind === 'global' ? 'sub' : undefined">{{ originText(p) }}</span>
                <span v-if="p.builtIn === 'edited'" class="badge muted" style="margin-left: 6px">edited</span>
              </td>
              <td>
                <button class="btn sm ghost" type="button" :aria-expanded="viewing === p.file" @click="toggle(p)">{{ viewing === p.file ? "Hide" : "View" }}</button>
              </td>
            </tr>
            <tr v-if="viewing === p.file" style="background: var(--muted)">
              <td colspan="7" style="padding: 16px 14px"><PlaybookDetail :playbook="p" /></td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else-if="list" class="empty" style="margin: 14px">No playbooks found.</p>
  </section>

  <section v-if="list?.problems.length" class="panel">
    <h2>Files that could not be read</h2>
    <div v-for="p in list.problems" :key="p.file" class="status-row warn">
      <span class="dot attn" style="margin-top: 6px"></span>
      <div class="w"><div class="h mono" style="font-size: 12px">{{ p.file }}</div><div class="d">{{ p.error }}</div></div>
    </div>
  </section>
</template>
