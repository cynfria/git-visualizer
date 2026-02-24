export type BranchStatus = 'fresh' | 'stale' | 'conflict-risk' | 'unknown';

export interface Branch {
  name: string;
  commitsAhead: number;
  commitsBehind: number;
  lastCommitDate: string;
  lastCommitAuthor: string;
  lastCommitAuthorAvatar: string;
  mergeable: boolean | null;
  status: BranchStatus;
  // For branch map positioning
  divergedFromSha?: string;
  divergedFromDate?: string; // date of the merge-base commit, used for X positioning
  headSha?: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  authorAvatar: string;
  date: string;
}

export interface MergeNode {
  sha: string;       // 7-char for display
  fullSha: string;   // full SHA for diverge-point matching
  prNumber: number | null;
  prTitle: string | null;
  date: string;
}

export interface MergedPR {
  number: number;
  title: string;
  branchName: string;
  authorLogin: string;
  authorAvatar: string;
  createdAt: string;  // approximate fork date
  mergedAt: string;   // when it landed on main
  commitCount: number;
}

export interface DiffResult {
  success: boolean;
  mainScreenshot: string | null;
  branchScreenshot: string | null;
  diffImage: string | null;
  changedPixels: number | null;
  totalPixels: number | null;
  errorMessage: string | null;
  buildLog: string | null;
}

export interface ChangedFile {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface ComponentGroup {
  label: string;
  folder: string;
  additions: number;
  deletions: number;
  files: ChangedFile[];
}
