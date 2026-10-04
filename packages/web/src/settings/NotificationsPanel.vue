<script setup lang="ts">
import { notifyEnabled, notifyPermission, requestNotifyPermission, setNotifyEnabled } from "../asks/notifications";
</script>

<template>
  <section class="panel">
    <h2>Notifications</h2>
    <p class="sub">
      A browser notification when an agent asks for permission and the answer is yours. The tab title and icon show how many asks
      wait, with or without notifications. This setting belongs to this browser.
    </p>
    <label class="switch">
      <input type="checkbox" :checked="notifyEnabled" @change="setNotifyEnabled(($event.target as HTMLInputElement).checked)" />
      Notify me about new permission asks
    </label>
    <p v-if="notifyPermission === 'unsupported'" class="sub">This browser has no notifications.</p>
    <template v-else-if="notifyPermission === 'default'">
      <button class="btn btn-primary" type="button" @click="requestNotifyPermission()">Allow browser notifications</button>
    </template>
    <p v-else-if="notifyPermission === 'denied'" class="sub">The browser blocks notifications for this site. Allow them in the site settings of your browser.</p>
    <p v-else class="sub">The browser allows notifications.</p>
  </section>
</template>

<style scoped>
.switch { display: flex; align-items: center; gap: 8px; margin: 12px 0; }
</style>
