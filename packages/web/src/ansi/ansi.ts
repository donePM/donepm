import Anser from "anser";
import ansiRegex from "ansi-regex";

/** A run of text with one style. Base colours are classes (themed in theme.css), the rest inline CSS. */
export interface AnsiSegment {
  text: string;
  classes: string[];
  style?: { color?: string; backgroundColor?: string };
}

const BASE = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"];
const BASE_NAMES = [...BASE, ...BASE.map((c) => `bright-${c}`)];

/** xterm colours 16-255: a 6x6x6 cube, then 24 greys. */
function paletteRgb(n: number): string {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return `rgb(${v}, ${v}, ${v})`;
  }
  const i = n - 16;
  const level = (x: number) => (x === 0 ? 0 : 55 + x * 40);
  return `rgb(${level(Math.floor(i / 36))}, ${level(Math.floor(i / 6) % 6)}, ${level(i % 6)})`;
}

/** Keep only SGR (colour and weight) sequences; drop cursor movement, OSC titles and links, and the rest. */
function keepSgr(text: string): string {
  return text.replace(ansiRegex(), (seq) => (/^\u001b\[[0-9;:]*m$/.test(seq) ? seq : ""));
}

/** A progress bar redraws its line with `\r`: what stays visible is the last non-empty write. */
function lastCarriageReturnState(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const writes = line.split("\r");
      for (let i = writes.length - 1; i >= 0; i--) if (writes[i]!.replace(ansiRegex(), "") !== "") return writes[i]!;
      return "";
    })
    .join("\n");
}

/** Resolve one colour from anser's class form to a class suffix or a CSS colour. */
function colour(name: string | null, truecolor: string | null): { cls?: string; css?: string } {
  if (!name) return {};
  if (name === "ansi-truecolor") return truecolor ? { css: `rgb(${truecolor})` } : {};
  const palette = /^ansi-palette-(\d+)$/.exec(name);
  if (palette) {
    const n = Number(palette[1]);
    return n < 16 ? { cls: BASE_NAMES[n] } : { css: paletteRgb(n) };
  }
  const cls = name.replace(/^ansi-/, "");
  return BASE_NAMES.includes(cls) ? { cls } : {};
}

/** Tool output split into styled runs. Everything but SGR sequences is removed; text is never treated as HTML. */
export function ansiSegments(input: string): AnsiSegment[] {
  const text = keepSgr(lastCarriageReturnState(input));
  const entries = Anser.ansiToJson(text, { json: true, use_classes: true, remove_empty: true });
  return entries.map((e) => {
    const fg = colour(e.fg, e.fg_truecolor);
    const bg = colour(e.bg, e.bg_truecolor);
    const classes = e.decorations
      .filter((d) => d === "bold" || d === "dim" || d === "italic" || d === "underline")
      .map((d) => `ansi-${d}`);
    if (fg.cls) classes.push(`ansi-fg-${fg.cls}`);
    if (bg.cls) classes.push(`ansi-bg-${bg.cls}`);
    const style = fg.css || bg.css ? { ...(fg.css && { color: fg.css }), ...(bg.css && { backgroundColor: bg.css }) } : undefined;
    return { text: e.content, classes, style };
  });
}
