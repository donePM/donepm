// jira2md ships no types; this is the one function donePM uses.
declare module "jira2md" {
  const j2m: {
    /** Markdown to Jira wiki markup. */
    to_jira(markdown: string): string;
  };
  export default j2m;
}
