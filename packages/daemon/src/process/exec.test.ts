import { describe, expect, it } from "vitest";
import { exec } from "./exec.js";

describe("exec", () => {
  it("writes input to the child's stdin and closes it", async () => {
    const r = await exec("cat", [], { input: "secret line\n" });
    expect(r).toEqual({ code: 0, stdout: "secret line\n", stderr: "" });
  });

  it("reports a command that cannot start instead of throwing", async () => {
    const r = await exec("donepm-no-such-command", [], { input: "x" });
    expect(r.code).toBe(-1);
  });
});
