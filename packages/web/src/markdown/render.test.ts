// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
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
});

describe("renderMarkdown never lets script through", () => {
  it.each([
    ["script tag", "<script>alert(1)</script>"],
    ["onerror", '<img src="x" onerror="alert(1)">'],
    ["iframe", '<iframe src="https://evil.example"></iframe>'],
    ["javascript: link", "[x](javascript:alert(1))"],
    ["javascript: autolink", "<javascript:alert(1)>"],
    ["data: image", "![x](data:text/html,<script>alert(1)</script>)"],
  ])("%s", (_, src) => {
    const doc = document.createElement("div");
    doc.innerHTML = html(src);
    expect(doc.querySelector("script, iframe")).toBeNull();
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of el.attributes) {
        expect(attr.name).not.toMatch(/^on/i);
        expect(attr.value).not.toMatch(/^\s*(javascript|data):/i);
      }
    }
  });
});

describe("repoOf", () => {
  it("reads owner and name from an external id", () => {
    expect(repoOf("acme/shop#12")).toEqual(repo);
    expect(repoOf("PROJ-12")).toBeUndefined();
  });
});
