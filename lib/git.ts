import { invoke } from '@tauri-apps/api/core';
import type { Branch, MergeNode } from '../types';

export interface RepoInfo {
  name: string;
  path: string;
}

export interface MergeNodesResponse {
  nodes: MergeNode[];
  hasMore: boolean;
}

export async function getBranches(repoPath: string): Promise<Branch[]> {
  return invoke('get_branches', { repoPath });
}

export async function getMergeNodes(
  repoPath: string,
  branch: string,
  page: number,
  perPage: number
): Promise<MergeNodesResponse> {
  return invoke('get_merge_nodes', { repoPath, branch, page, perPage });
}

export async function getDefaultBranch(repoPath: string): Promise<string> {
  return invoke('get_default_branch', { repoPath });
}

export async function getRepoInfo(repoPath: string): Promise<RepoInfo> {
  return invoke('get_repo_info', { repoPath });
}
