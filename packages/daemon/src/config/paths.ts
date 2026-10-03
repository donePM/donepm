import { join } from "node:path";

export interface Paths {
  home: string;
  configDir: string;
  configFile: string;
  dataDir: string;
  dbFile: string;
}

/** Spec 14: config in `~/.config/donepm`, data in `~/.local/share/donepm`. */
export function pathsFor(home: string): Paths {
  const configDir = join(home, ".config", "donepm");
  const dataDir = join(home, ".local", "share", "donepm");
  return {
    home,
    configDir,
    configFile: join(configDir, "config.json"),
    dataDir,
    dbFile: join(dataDir, "donepm.db"),
  };
}

/** Expand a leading `~` to the home directory. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return join(home, path.slice(2));
  return path;
}
