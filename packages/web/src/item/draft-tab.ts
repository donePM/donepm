/** The draft body's two tabs. Preview shows the form's text, saved or not. */
export type DraftTab = "write" | "preview";

/** A fresh draft opens on Preview: the user reads before editing. Once edited, Write. */
export function draftTab(dirty: boolean): DraftTab {
  return dirty ? "write" : "preview";
}
