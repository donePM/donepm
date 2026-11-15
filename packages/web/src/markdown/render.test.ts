// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import dependabotBody from "./fixtures/dependabot-body.md?raw";
import { renderMarkdown, repoOf } from "./render";

const repo = { owner: "acme", name: "shop" };
const html = (src: string) => renderMarkdown(src, repo);

describe("renderMarkdown", () => {
  it("renders headings, emphasis and rules", () => {
    const out = html("# Title\n\n**bold** _em_ ~~gone~~\n\n---");
    expect(out).toContain("<h1>Title</h1>");
    expect(out).toContain("<strong>bold</strong>");
    expect(out).toContain("<em>em</em>");
    expect(out).toContain("<s>gone</s>");
    expect(out).toContain("<hr>");
  });

  it("renders lists and read-only task lists", () => {
    const out = html("- [x] done\n- [ ] open\n\n1. one");
    expect(out).toContain('class="contains-task-list"');
    expect(out).toMatch(/<input[^>]*checked[^>]*>/);
    expect(out.match(/<input[^>]*disabled/g)).toHaveLength(2);
    expect(out).toContain("<ol>");
  });

  it("renders tables", () => {
    const out = html("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(out).toContain("<table>");
    expect(out).toContain("<th>a</th>");
    expect(out).toContain("<td>2</td>");
  });

  it("renders fenced code with its language and inline code", () => {
    const out = html("```ts\nconst a = 1 < 2;\n```\n\nuse `pnpm`");
    expect(out).toContain('<code class="language-ts">const a = 1 &lt; 2;\n</code>');
    expect(out).toContain("<code>pnpm</code>");
  });

  it("renders blockquotes and autolinks", () => {
    const out = html("> quoted\n\nsee https://example.com/x");
    expect(out).toContain("<blockquote>");
    expect(out).toContain('href="https://example.com/x"');
  });

  it("opens every outside link in a new tab without opener", () => {
    const out = html("[docs](https://example.com)");
    expect(out).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>');
  });

  it("keeps anchors in the page", () => {
    expect(html("[up](#top)")).toBe('<p><a href="#top">up</a></p>\n');
  });

  it("resolves relative links and images against the repository", () => {
    const out = html("[readme](docs/README.md) ![shot](./img/a.png)");
    expect(out).toContain('href="https://github.com/acme/shop/blob/HEAD/docs/README.md"');
    expect(out).toContain('src="https://github.com/acme/shop/raw/HEAD/img/a.png"');
  });

  it("leaves relative links as text without a repository", () => {
    expect(renderMarkdown("[readme](docs/README.md)")).toBe("<p><a>readme</a></p>\n");
  });

  it("loads GitHub images and turns other images into links", () => {
    const out = html("![a](https://user-images.githubusercontent.com/1/a.png) ![b](https://tracker.example/p.gif)");
    expect(out).toContain('<img src="https://user-images.githubusercontent.com/1/a.png" alt="a"');
    expect(out).not.toContain('src="https://tracker.example');
    expect(out).toContain('<a href="https://tracker.example/p.gif" target="_blank" rel="noopener noreferrer">b</a>');
  });

  it("links issue references and mentions", () => {
    const out = html("Fixes #12, see other/lib#3 and ask @octo-cat. Not mail@host.com or a#1.");
    expect(out).toContain('<a href="https://github.com/acme/shop/issues/12" target="_blank" rel="noopener noreferrer">#12</a>');
    expect(out).toContain('href="https://github.com/other/lib/issues/3"');
    expect(out).toContain('href="https://github.com/octo-cat"');
    expect(out).not.toContain("github.com/host");
    expect(out).not.toContain("issues/1\"");
  });

  it("does not link references inside code or links", () => {
    const out = html("`#12` and [see #13](https://example.com)");
    expect(out).toContain("<code>#12</code>");
    expect(out).not.toContain("issues/13");
  });

  it("leaves #123 as text without a repository", () => {
    expect(renderMarkdown("#12 is it")).toBe("<p>#12 is it</p>\n");
  });

  it("links no @name or #123 in a ticket's text (issue #139)", () => {
    expect(renderMarkdown("ask @dana about #12", undefined, { noReferences: true })).toBe("<p>ask @dana about #12</p>\n");
  });
});

describe("renderMarkdown with embedded HTML", () => {
  const dom = (src: string, r = repo) => {
    const el = document.createElement("div");
    el.innerHTML = renderMarkdown(src, r);
    return el;
  };

  it("renders a Dependabot body like GitHub", () => {
    // Recorded from donePM/donepm#85, trimmed to a few entries per list.
    const el = dom(dependabotBody, { owner: "donePM", name: "donepm" });
    const details = el.querySelectorAll("details");
    expect(details).toHaveLength(2);
    expect(details[0]!.querySelector("summary")!.textContent).toBe("Release notes");
    expect(details[0]!.querySelector("blockquote h2")!.textContent).toBe("v3.0.0");
    expect(details[1]!.querySelectorAll("li")).toHaveLength(4);
    expect(el.textContent).not.toMatch(/<\/?(details|summary|p|ul|li|a|code|h2|blockquote)\b/);
    // The zero-width space Dependabot puts after `@` stays, so no mention link is made.
    expect(el.querySelector("li code")!.textContent).toBe("@\u200bppkarwasz");
    expect(el.innerHTML).not.toContain("raw HTML omitted");
    const link = el.querySelector('a[href="https://github.com/ppkarwasz"]')!;
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(el.querySelector('a[href="https://github.com/dependabot/fetch-metadata"]')).not.toBeNull();
  });

  it("renders inline tags inside Markdown", () => {
    const out = html("Press <kbd>Ctrl</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <b>bold</b>");
    expect(out).toBe("<p>Press <kbd>Ctrl</kbd>, H<sub>2</sub>O, x<sup>2</sup>, <b>bold</b></p>\n");
  });

  it("keeps Markdown working between HTML blocks", () => {
    const el = dom("<details open>\n<summary>More</summary>\n\n- **one**\n- two\n\n</details>");
    expect(el.querySelector("details")!.hasAttribute("open")).toBe(true);
    expect(el.querySelector("details ul strong")!.textContent).toBe("one");
  });

  it("treats links and images in raw HTML like Markdown ones", () => {
    const el = dom('<a href="docs/a.md">rel</a> <img src="./i.png" alt="i"> <img src="https://tracker.example/p.gif" alt="t">');
    expect(el.querySelector("a")!.getAttribute("href")).toBe("https://github.com/acme/shop/blob/HEAD/docs/a.md");
    expect(el.querySelector("img")!.getAttribute("src")).toBe("https://github.com/acme/shop/raw/HEAD/i.png");
    expect(el.querySelectorAll("img")).toHaveLength(1);
    const tracker = el.querySelector('a[href="https://tracker.example/p.gif"]')!;
    expect(tracker.textContent).toBe("t");
    expect(tracker.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("does not link references inside raw links", () => {
    expect(html('<a href="https://example.com">see #13</a>')).not.toContain("issues/13");
  });

  it("prefixes ids and names so a body cannot clobber the page", () => {
    const el = dom('<a id="app" name="x">a</a>');
    expect(el.querySelector("a")!.id).toBe("user-content-app");
  });
});

describe("renderMarkdown never lets script through", () => {
  it.each([
    ["script tag", "<script>alert(1)</script>"],
    ["inline script", "text <script>alert(1)</script> more"],
    ["onerror", '<img src="x" onerror="alert(1)">'],
    ["onclick", '<details><summary onclick="alert(1)">s</summary></details>'],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["javascript: raw link", '<a href="javascript:alert(1)">x</a>'],
    ["javascript: entity link", '<a href="jav&#x61;script:alert(1)">x</a>'],
    ["svg", '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>'],
    ["data: raw image", '<img src="data:image/svg+xml,<svg onload=alert(1)>">'],
    ["javascript: link", "[x](javascript:alert(1))"],
    ["javascript: autolink", "<javascript:alert(1)>"],
    ["data: image", "![x](data:text/html,<script>alert(1)</script>)"],
  ])("%s", (_, src) => {
    const doc = document.createElement("div");
    doc.innerHTML = html(src);
    expect(doc.querySelector("script, iframe, svg")).toBeNull();
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        expect(attr.name).not.toMatch(/^on/i);
        expect(attr.value).not.toMatch(/^\s*(javascript|data):/i);
      }
    }
  });
});

describe("renderMarkdown strips what GitHub strips", () => {
  it.each([
    ["style tag", "<style>body { display: none }</style>", "style"],
    ["form", '<form action="https://evil.example"><input name="q"><button>go</button></form>', "form, input, button"],
    ["media", '<video src="https://evil.example/v.mp4"></video><audio src="https://evil.example/a.mp3"></audio>', "video, audio"],
    ["object", '<object data="https://evil.example/x"></object><embed src="https://evil.example/x">', "object, embed"],
    ["base and meta", '<base href="https://evil.example/"><meta http-equiv="refresh" content="0">', "base, meta"],
  ])("%s", (_, src, selector) => {
    const doc = document.createElement("div");
    doc.innerHTML = html(src);
    expect(doc.querySelector(selector)).toBeNull();
  });

  it("drops style and srcset attributes", () => {
    const out = html('<p style="position:fixed">x</p><img src="https://github.com/a.png" srcset="https://evil.example/b.png 2x">');
    expect(out).not.toContain("style=");
    expect(out).not.toContain("srcset");
  });
});

describe("repoOf", () => {
  it("reads owner and name from an external id", () => {
    expect(repoOf("acme/shop#12")).toEqual(repo);
    expect(repoOf("PROJ-12")).toBeUndefined();
  });

  it("keeps the host of an issue off github.com (issue #140)", () => {
    expect(repoOf("github.acme.com/team/app#7")).toEqual({ owner: "team", name: "app", host: "github.acme.com" });
    expect(repoOf("a/b/c/d#1")).toBeUndefined();
  });

  it("links references and relative links to that host", () => {
    const out = renderMarkdown("Fixes #12, see other/lib#3, ask @jdoe, [readme](docs/README.md)", repoOf("github.acme.com/team/app#7"));
    expect(out).toContain('href="https://github.acme.com/team/app/issues/12"');
    expect(out).toContain('href="https://github.acme.com/other/lib/issues/3"');
    expect(out).toContain('href="https://github.acme.com/jdoe"');
    expect(out).toContain('href="https://github.acme.com/team/app/blob/HEAD/docs/README.md"');
    expect(out).not.toContain("https://github.com");
  });
});
