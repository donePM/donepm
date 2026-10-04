// @vitest-environment jsdom
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import AnsiText from "./AnsiText.vue";
import { ansiSegments } from "./ansi";

const E = "\u001b";
const text = (input: string) => ansiSegments(input).map((s) => s.text).join("");
const html = (input: string) => renderToString(createSSRApp({ render: () => h(AnsiText, { text: input }) }));

describe("ansiSegments", () => {
  it("renders a recorded vitest line with green tick and dim counts", () => {
    const line = `  ${E}[32m✓${E}[39m src/ask/web-fetch.test.ts ${E}[2m(${E}[22m ${E}[2m7 tests${E}[22m${E}[2m)${E}[22m ${E}[32m 2${E}[2mms${E}[22m${E}[39m`;
    const segs = ansiSegments(line);
    expect(text(line)).toBe("  ✓ src/ask/web-fetch.test.ts ( 7 tests)  2ms");
    expect(segs.find((s) => s.text === "✓")?.classes).toContain("ansi-fg-green");
    expect(segs.find((s) => s.text === "7 tests")?.classes).toContain("ansi-dim");
    expect(JSON.stringify(segs)).not.toContain("u001b");
  });

  it("handles pnpm output with bold, bright colours and cursor control", () => {
    const out = `${E}[1m${E}[36mProgress${E}[39m${E}[22m: resolved 1${E}[0K\n${E}[2K${E}[1G${E}[91mERR_PNPM${E}[39m failed`;
    expect(text(out)).toBe("Progress: resolved 1\nERR_PNPM failed");
    const segs = ansiSegments(out);
    expect(segs[0]?.classes).toEqual(expect.arrayContaining(["ansi-bold", "ansi-fg-cyan"]));
    expect(segs.find((s) => s.text === "ERR_PNPM")?.classes).toContain("ansi-fg-bright-red");
  });

  it("handles git colour output", () => {
    const out = `${E}[33mcommit abc123${E}[m\n${E}[31m-old${E}[m\n${E}[32m+new${E}[m`;
    expect(text(out)).toBe("commit abc123\n-old\n+new");
    expect(ansiSegments(out).find((s) => s.text === "-old")?.classes).toContain("ansi-fg-red");
  });

  it("supports 256 colours, truecolor, backgrounds, italic and underline", () => {
    const segs = ansiSegments(`${E}[38;5;2ma${E}[38;5;196mb${E}[38;2;1;2;3;48;2;9;8;7mc${E}[0m${E}[44;3;4md`);
    expect(segs[0]?.classes).toContain("ansi-fg-green");
    expect(segs[1]?.style?.color).toBe("rgb(255, 0, 0)");
    expect(segs[2]?.style).toEqual({ color: "rgb(1, 2, 3)", backgroundColor: "rgb(9, 8, 7)" });
    expect(segs[3]?.classes).toEqual(expect.arrayContaining(["ansi-bg-blue", "ansi-italic", "ansi-underline"]));
  });

  it("removes unknown sequences: cursor movement, OSC titles and hyperlinks", () => {
    const out = `${E}[?25l${E}[2J${E}[3Ahello${E}]0;title\u0007 ${E}]8;;http://x${E}\\link${E}]8;;${E}\\${E}[?25h`;
    expect(text(out)).toBe("hello link");
  });

  it("keeps the last state of a line overwritten with carriage returns", () => {
    expect(text("10%\r50%\r100%\ndone\r\nnext")).toBe("100%\ndone\nnext");
    expect(text(`${E}[32m1/3${E}[0m\r${E}[32m3/3${E}[0m`)).toBe("3/3");
  });
});

describe("AnsiText", () => {
  it("keeps HTML in the input escaped", async () => {
    const out = await html(`${E}[31m<img src=x onerror=alert(1)>${E}[0m <script>x</script> &amp;`);
    expect(out).not.toContain("<img");
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(out).toContain("&amp;amp;");
    expect(out).toContain("ansi-fg-red");
  });
});
