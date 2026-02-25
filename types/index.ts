export type BranchStatus = 'fresh' | 'stale' | 'conflict-risk' | 'unknown';

export interface Branch {
  name: string;
  commitsAhead: number;
  commitsBehind: number;
  lastCommitDate: string;
  lastCommitAuthor: string;
  lastCommitAuthorAvatar?: string;
  mergeable?: boolean | null;
  status: BranchStatus;
  headSha: string;
  divergedFromSha?: string;
  divergedFromDate?: string;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface MergeNode {
  sha: string;
  fullSha: string;
  prNumber: number | null;
  prTitle: string | null;
  date: string;
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
