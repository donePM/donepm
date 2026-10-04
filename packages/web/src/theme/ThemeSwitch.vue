<script setup lang="ts">
import { computed } from "vue";
import IconMonitor from "../icons/IconMonitor.vue";
import IconMoon from "../icons/IconMoon.vue";
import IconSun from "../icons/IconSun.vue";
import { cycleTheme, themeChoice } from "./apply";
import { themeLabel } from "./theme";

const icon = computed(() => ({ system: IconMonitor, light: IconSun, dark: IconMoon })[themeChoice.value]);
const label = computed(() => themeLabel(themeChoice.value));
</script>

<template>
  <button class="iconbtn" type="button" :aria-label="label" :title="label" @click="cycleTheme"><component :is="icon" /></button>
</template>
