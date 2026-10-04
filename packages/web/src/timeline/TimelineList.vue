<script setup lang="ts">
import { computed } from "vue";
import type { Event, PermissionAsk } from "../api/types";
import IconClock from "../icons/IconClock.vue";
import { timeLabel, timelineEntries } from "./entries";

const props = defineProps<{ events: Event[]; asks: PermissionAsk[]; now: number }>();
const entries = computed(() => timelineEntries(props.events, props.asks));
const nowDate = computed(() => new Date(props.now));
const DOT = { attention: "attn", danger: "danger", user: "primary", system: "off" } as const;
</script>

<template>
  <section class="panel" aria-labelledby="timeline-h">
    <h2 id="timeline-h"><IconClock />Timeline</h2>
    <ol class="tl">
      <li v-for="e in entries" :key="e.id">
        <span class="dot" :class="DOT[e.tone]" aria-hidden="true"></span>
        <div class="w">
          <span class="text"><strong>{{ e.actor }}</strong> {{ e.verb }}<template v-if="e.code">{{ " " }}<code class="inline-code" :title="e.full">{{ e.code }}</code></template></span>
          <span class="t"><time :datetime="e.at">{{ timeLabel(e.at, nowDate) }}</time><template v-if="e.detail"> · {{ e.detail }}</template></span>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.panel { display: flex; flex-direction: column; gap: 6px; }
h2 { display: flex; align-items: center; gap: 8px; }
h2 .ic { color: var(--fg-3); }
.text, .t { line-height: 1.4; overflow-wrap: anywhere; }
.inline-code { white-space: pre-wrap; }
</style>
