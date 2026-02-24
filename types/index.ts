export type BranchStatus = 'fresh' | 'stale' | 'conflict-risk' | 'unknown';

export interface Branch {
  name: string;
  commitsAhead: number;
  commitsBehind: number;
  lastCommitDate: string;
  lastCommitAuthor: string;
  status: BranchStatus;
  headSha: string;
  divergedFromSha?: string;
  divergedFromDate?: string;
}

export interface MergeNode {
  sha: string;
  fullSha: string;
  prNumber: number | null;
  prTitle: string | null;
  date: string;
}
