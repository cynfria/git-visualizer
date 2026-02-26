import { fetchBranches, fetchMainMergeNodes, fetchMergedPRs } from '@/lib/github';
import { Branch, MergeNode, MergedPR } from '@/types';
import BranchMapView from '@/components/BranchMapView';

interface Props {
  params: Promise<{ owner: string; repo: string }>;
}

export default async function BranchMapPage({ params }: Props) {
  const { owner, repo } = await params;
  const token = process.env.GITHUB_PAT;

  let branches: Branch[] = [];
  let defaultBranch = 'main';
  let mergeNodes: MergeNode[] = [];
  let mergedPRs: MergedPR[] = [];
  let initialHasMore = false;
  let hasMoreBranchPages = false;
  let fetchError: string | null = null;

  try {
    const result = await fetchBranches(owner, repo, token);
    branches = result.branches;
    defaultBranch = result.defaultBranch;
    hasMoreBranchPages = result.hasMore;
    const [mergeResult, prs] = await Promise.all([
      fetchMainMergeNodes(owner, repo, defaultBranch, token, 1, 100),
      fetchMergedPRs(owner, repo, defaultBranch, token),
    ]);
    mergeNodes = mergeResult.nodes;
    initialHasMore = mergeResult.hasMore;
    mergedPRs = prs;
  } catch (e) {
    fetchError = e instanceof Error ? e.message : 'Failed to fetch branches';
  }

  return (
    <BranchMapView
      branches={branches}
      mergeNodes={mergeNodes}
      mergedPRs={mergedPRs}
      owner={owner}
      repo={repo}
      defaultBranch={defaultBranch}
      initialHasMore={initialHasMore}
      hasMoreBranchPages={hasMoreBranchPages}
      fetchError={fetchError}
    />
  );
}
