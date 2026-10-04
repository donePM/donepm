<script setup lang="ts">
import { computed } from "vue";
import type { Event, PermissionAsk } from "../api/types";
import { timeLabel, timelineEntries } from "./entries";

const props = defineProps<{ events: Event[]; asks: PermissionAsk[]; now: number }>();
const entries = computed(() => timelineEntries(props.events, props.asks));
const nowDate = computed(() => new Date(props.now));
</script>

<template>
  <section class="panel" aria-labelledby="timeline-h">
    <h2 id="timeline-h">Timeline</h2>
    <ol>
      <li v-for="e in entries" :key="e.id">
        <span class="dot" :class="`tone-${e.tone}`" aria-hidden="true"></span>
        <div>
          <div class="text">{{ e.text }}<template v-if="e.code">{{ " " }}<code :title="e.full">{{ e.code }}</code></template></div>
          <div class="sub"><time :datetime="e.at">{{ timeLabel(e.at, nowDate) }}</time><template v-if="e.detail"> · {{ e.detail }}</template></div>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
ol { list-style: none; margin: 12px 0 0; padding: 0; }
li { display: flex; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-soft); }
li:last-child { border-bottom: 0; }
.dot { margin-top: 6px; }
.tone-attention { background: var(--amber); }
.tone-danger { background: var(--danger); }
.tone-user { background: var(--blue); }
.tone-system { background: #9a9a92; }
.text { line-height: 1.4; overflow-wrap: anywhere; }
code { font-family: var(--mono); font-size: 12px; }
.sub { font-size: 12px; color: var(--ink-3); margin-top: 2px; overflow-wrap: anywhere; }
</style>
