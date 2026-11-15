import type { Status } from "../api/types";
import { health, tools } from "../status/health";

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

export type DotSection = "agents" | "tools";

/**
 * The dot of a section that shows tools: green when all is well, amber on a problem, grey while
 * unknown. Agents & access covers the coding agents; Tools covers the source clients and the poll
 * (issue #152).
 */
export function sectionDot(section: DotSection, status: Status | undefined, reachable: boolean): "ok" | "attn" | "off" {
  const h = health(status, reachable, tools.filter((t) => t.section === section), section === "tools");
  return h === "ok" ? "ok" : h === "problem" ? "attn" : "off";
}
