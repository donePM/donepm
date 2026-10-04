import DOMPurify, { type Config } from "dompurify";
import MarkdownIt from "markdown-it";
import taskLists from "markdown-it-task-lists";

/**
 * GitHub-flavoured Markdown to safe HTML (spec 12). Issue bodies, PR drafts and agent text are
 * written by other people or by a model. Like GitHub, embedded HTML renders (Dependabot's
 * `<details>` release notes), so the output goes through DOMPurify before it reaches `v-html`,
 * and links and images in raw HTML get the same treatment as Markdown ones.
 */

/** The GitHub repository relative links and `#123` point into. */
export interface RepoRef {
  owner: string;
  name: string;
}

/** `owner/repo#12` → the repo; undefined for anything else. */
export function repoOf(externalId: string): RepoRef | undefined {
  const m = /^([\w.-]+)\/([\w.-]+)#\d+$/.exec(externalId);
  return m ? { owner: m[1]!, name: m[2]! } : undefined;
}

const GITHUB = "https://github.com";

const md = new MarkdownIt({ html: true, linkify: true, breaks: false }).use(taskLists);

// `#12`, `owner/repo#12` and `@user` become links, like on GitHub. Only plain text outside links.
const REFERENCE = /(^|[^\w/@#&])(?:(?:([\w.-]+)\/([\w.-]+))?#(\d+)|@([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))(?![\w/-]))/g;

md.core.ruler.push("github-references", (state) => {
  const repo = state.env?.repo as RepoRef | undefined;
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    const out: typeof block.children = [];
    let inLink = 0;
    for (const token of block.children) {
      if (token.type === "link_open") inLink++;
      if (token.type === "link_close") inLink--;
      if (token.type === "html_inline" && /^<a[\s>]/i.test(token.content)) inLink++;
      if (token.type === "html_inline" && /^<\/a\s*>/i.test(token.content)) inLink--;
      if (token.type !== "text" || inLink > 0) {
        out.push(token);
        continue;
      }
      let last = 0;
      for (const m of token.content.matchAll(REFERENCE)) {
        const [whole, lead, owner, name, number, user] = m;
        const href = user
          ? `${GITHUB}/${user}`
          : owner && name
            ? `${GITHUB}/${owner}/${name}/issues/${number}`
            : repo
              ? `${GITHUB}/${repo.owner}/${repo.name}/issues/${number}`
              : undefined;
        if (!href) continue;
        const start = m.index + lead!.length;
        if (start > last) out.push(text(state, token.content.slice(last, start)));
        const open = new state.Token("link_open", "a", 1);
        open.attrSet("href", href);
        out.push(open, text(state, whole.slice(lead!.length)), new state.Token("link_close", "a", -1));
        last = m.index + whole.length;
      }
      if (last === 0) out.push(token);
      else if (last < token.content.length) out.push(text(state, token.content.slice(last)));
    }
    block.children = out;
  }
});

function text(state: { Token: new (type: string, tag: string, nesting: -1 | 0 | 1) => { content: string } }, content: string) {
  const t = new state.Token("text", "", 0);
  t.content = content;
  return t as never;
}

/** Hosts whose images load. Anything else stays a link: a remote image is a request the user did not make. */
const IMAGE_HOSTS = [/^github\.com$/, /(^|\.)githubusercontent\.com$/, /^user-images\.githubusercontent\.com$/];

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;
const SAFE_LINK = /^(https?|mailto):/i;

function resolve(url: string, repo: RepoRef | undefined, kind: "blob" | "raw" = "blob"): string | undefined {
  if (url.startsWith("#")) return url;
  if (ABSOLUTE.test(url) || url.startsWith("//")) return SAFE_LINK.test(url) ? url : undefined;
  if (!repo) return undefined;
  const base = `${GITHUB}/${repo.owner}/${repo.name}/${kind}/HEAD/`;
  try {
    return new URL(url.replace(/^\.?\//, ""), base).href;
  } catch {
    return undefined;
  }
}

function imageAllowed(src: string): boolean {
  try {
    const host = new URL(src).hostname;
    return IMAGE_HOSTS.some((h) => h.test(host));
  } catch {
    return false;
  }
}

type Env = { repo?: RepoRef };

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const href = resolve(String(token.attrGet("href") ?? ""), (env as Env).repo, "blob");
  // A link nobody can follow reads as its text.
  if (href) token.attrSet("href", href);
  else token.attrs = (token.attrs ?? []).filter(([name]) => name !== "href");
  return self.renderToken(tokens, idx, options);
};

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx]!;
  const alt = self.renderInlineAsText(token.children ?? [], options, env);
  const src = resolve(String(token.attrGet("src") ?? ""), (env as Env).repo, "raw");
  if (src && imageAllowed(src)) {
    token.attrSet("src", src);
    token.attrSet("alt", alt);
    token.attrSet("loading", "lazy");
    token.attrSet("referrerpolicy", "no-referrer");
    return self.renderToken(tokens, idx, options);
  }
  const label = md.utils.escapeHtml(alt || src || "");
  return src && SAFE_LINK.test(src) ? `<a href="${md.utils.escapeHtml(src)}">${label}</a>` : label;
};

const purify = DOMPurify();

const SANITIZE: Config & { RETURN_DOM: true } = {
  USE_PROFILES: { html: true },
  // Things GitHub drops too: forms, styling, and media that would load from anywhere.
  FORBID_TAGS: ["style", "form", "button", "select", "option", "optgroup", "textarea", "audio", "video", "source", "track", "picture"],
  FORBID_ATTR: ["style", "srcset", "background", "poster", "action", "formaction"],
  // `id` and `name` get a `user-content-` prefix so a body cannot clobber the app's own.
  SANITIZE_NAMED_PROPS: true,
  RETURN_DOM: true,
};

/**
 * Links and images from raw HTML never passed the Markdown rules, so every one is checked here,
 * after sanitizing: hrefs resolve like Markdown links, outside images become links, and every
 * outside link opens in a new tab (DOMPurify drops `target` from input).
 */
function finish(root: HTMLElement, repo: RepoRef | undefined): void {
  for (const img of root.querySelectorAll("img")) {
    const src = resolve(img.getAttribute("src") ?? "", repo, "raw");
    if (src && imageAllowed(src)) {
      img.setAttribute("src", src);
      img.setAttribute("referrerpolicy", "no-referrer");
      if (!img.hasAttribute("loading")) img.setAttribute("loading", "lazy");
      continue;
    }
    const label = img.getAttribute("alt") || src || "";
    if (src && SAFE_LINK.test(src)) {
      const a = img.ownerDocument.createElement("a");
      a.setAttribute("href", src);
      a.textContent = label;
      img.replaceWith(a);
    } else {
      img.replaceWith(label);
    }
  }
  // Only read-only task-list checkboxes come out of the parser; a raw `<input>` is not one.
  for (const input of root.querySelectorAll("input")) {
    if (input.getAttribute("type") === "checkbox" && input.classList.contains("task-list-item-checkbox")) {
      input.setAttribute("disabled", "");
    } else {
      input.remove();
    }
  }
  for (const a of root.querySelectorAll("a")) {
    const raw = a.getAttribute("href");
    if (raw === null) continue;
    const href = resolve(raw, repo);
    if (!href) {
      a.removeAttribute("href");
      continue;
    }
    a.setAttribute("href", href);
    if (href.startsWith("#")) continue;
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
  }
}

/** Safe HTML for `v-html`. `repo` resolves relative links and `#123`; without it they stay text. */
export function renderMarkdown(source: string, repo?: RepoRef): string {
  // RETURN_DOM hands back the `<body>` the sanitized markup was parsed into.
  const root = purify.sanitize(md.render(source, { repo } satisfies Env), SANITIZE) as HTMLElement;
  finish(root, repo);
  return root.innerHTML;
}
