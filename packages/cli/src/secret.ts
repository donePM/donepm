import { createInterface } from "node:readline";
import { Writable } from "node:stream";

/**
 * A secret from stdin when it is piped (`pbpaste | donepm token set jira`), else typed at a prompt
 * on stderr that does not echo what is typed.
 */
export async function readSecret(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) {
    let text = "";
    for await (const chunk of process.stdin) text += String(chunk);
    return text;
  }
  process.stderr.write(prompt);
  const silent = new Writable({ write: (_chunk, _encoding, done) => done() });
  const rl = createInterface({ input: process.stdin, output: silent, terminal: true });
  try {
    return await new Promise<string>((resolve) => rl.question("", resolve));
  } finally {
    rl.close();
    process.stderr.write("\n");
  }
}
