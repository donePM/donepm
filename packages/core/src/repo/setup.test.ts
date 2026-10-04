import { describe, expect, it } from "vitest";
import { RepoSetupError, parseRepoSetup } from "./setup.js";

describe("parseRepoSetup", () => {
  it("parses copy and run", () => {
    const src = "copy:\n  - .env\n  - storage/oauth-private.key\nrun:\n  - composer install\n  - npm ci\n";
    expect(parseRepoSetup(src)).toEqual({
      copy: [".env", "storage/oauth-private.key"],
      run: ["composer install", "npm ci"],
    });
  });

  it("treats an empty file as no setup", () => {
    expect(parseRepoSetup("")).toEqual({});
    expect(parseRepoSetup("# nothing yet\n")).toEqual({});
  });

  it("accepts only one of the keys", () => {
    expect(parseRepoSetup("run: [pnpm install]\n")).toEqual({ run: ["pnpm install"] });
  });

  it("parses dependencies", () => {
    expect(parseRepoSetup("dependencies: off\n")).toEqual({ dependencies: "off" });
    expect(parseRepoSetup("dependencies: auto\nrun: [make]\n")).toEqual({ dependencies: "auto", run: ["make"] });
    expect(() => parseRepoSetup("dependencies: yes\n")).toThrow(/dependencies/);
  });

  it("rejects unknown keys", () => {
    expect(() => parseRepoSetup("copy: [.env]\nbuild: [make]\n")).toThrow(RepoSetupError);
  });

  it("rejects wrong types", () => {
    expect(() => parseRepoSetup("run: npm ci\n")).toThrow(/run/);
    expect(() => parseRepoSetup("- npm ci\n")).toThrow(RepoSetupError);
  });

  it("rejects copy paths that leave the repository", () => {
    expect(() => parseRepoSetup("copy: [../secrets]\n")).toThrow(/inside the repository/);
    expect(() => parseRepoSetup("copy: [/etc/passwd]\n")).toThrow(/inside the repository/);
  });

  it("rejects invalid YAML", () => {
    expect(() => parseRepoSetup("copy: [\n")).toThrow(RepoSetupError);
  });
});
