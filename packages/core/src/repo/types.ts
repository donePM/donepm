export interface RepoSetup {
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
