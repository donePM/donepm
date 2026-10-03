import { onScopeDispose, ref } from "vue";

/** Reactive `Date.now()`, ticking every `ms`, for relative times. */
export function useNow(ms = 5000) {
  const now = ref(Date.now());
  const t = setInterval(() => (now.value = Date.now()), ms);
  onScopeDispose(() => clearInterval(t));
  return now;
}
