<script setup lang="ts">
import { computed, type Component } from "vue";
import IconExternal from "../icons/IconExternal.vue";
import IconGitHub from "../icons/IconGitHub.vue";
import IconGlobe from "../icons/IconGlobe.vue";
import { sourceLink, type SourceIconName } from "./source-link";

/**
 * A link that leaves donePM for the ticket's source: the source's icon, the text, and an
 * external-link arrow (issue #151). Classes and attributes fall through to the <a>.
 */
const props = defineProps<{
  source: string;
  url: string;
  /** Names the target in the tooltip ("o/r#4 on GitHub"); without it the tooltip says "Open on GitHub". */
  label?: string;
}>();
const ICONS: Record<SourceIconName, Component> = { github: IconGitHub, web: IconGlobe };
const link = computed(() => sourceLink({ source: props.source, externalUrl: props.url }));
</script>

<template>
  <a :href="url" target="_blank" rel="noreferrer" class="src-link" :title="label ? `${label} on ${link.site}` : `Open on ${link.site}`">
    <component :is="ICONS[link.icon]" class="src-ic" /><slot /><IconExternal class="ext-ic" />
  </a>
</template>

<style scoped>
.src-link { display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
.src-ic { width: 13px; height: 13px; flex: none; }
.ext-ic { width: 11px; height: 11px; flex: none; opacity: 0.7; }
</style>
