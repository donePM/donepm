import type { Status } from "../api/types";
import { health } from "../status/health";

export type SectionId = "general" | "repositories" | "agents" | "playbooks" | "tools" | "daemon";

export interface Section {
  id: SectionId;
  label: string;
  group: "Workspace" | "Agents" | "System";
}

/** Settings' sections in navigation order, under `/settings/<id>` (issue #127). */
export const SECTIONS: Section[] = [
  { id: "general", label: "General", group: "Workspace" },
  { id: "repositories", label: "Repositories", group: "Workspace" },
  { id: "agents", label: "Agents & access", group: "Agents" },
  { id: "playbooks", label: "Playbooks", group: "Agents" },
  { id: "tools", label: "Tools", group: "System" },
  { id: "daemon", label: "Daemon", group: "System" },
];

/** The sections under their group headings, in order. */
export function sectionGroups(sections: readonly Section[] = SECTIONS): { group: Section["group"]; sections: Section[] }[] {
  const out: { group: Section["group"]; sections: Section[] }[] = [];
  for (const s of sections) {
    const last = out.at(-1);
    if (last?.group === s.group) last.sections.push(s);
    else out.push({ group: s.group, sections: [s] });
  }
  return out;
}

/** The Tools entry's dot: green when all is well, amber on a problem, grey while unknown. */
export function toolsDot(status: Status | undefined, reachable: boolean): "ok" | "attn" | "off" {
  const h = health(status, reachable);
  return h === "ok" ? "ok" : h === "problem" ? "attn" : "off";
}
