export interface RepoSetup {
  /** `off` skips the dependencies step (spec 7.3, D34). Default `auto`. */
  dependencies?: "auto" | "off";
  copy?: string[];
  run?: string[];
}

export interface Repo {
  id: string;
  /** Local clone. */
  path: string;
  /** Normalised: `github.com/owner/repo`. */
  originUrl: string;
  defaultBranch: string;
  setup?: RepoSetup;
}
