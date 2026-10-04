/** How long since `iso`: "12 s", "3 min", "2 h", "4 d". Clock skew clamps to 0 s. */
export function since(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d`;
}

/** "12 s ago", "3 min ago", "2 h ago", "4 d ago". */
export function ago(iso: string, now: number): string {
  return `${since(iso, now)} ago`;
}
