import Link from 'next/link';
import { fetchBranches, fetchMainMergeNodes, fetchMergedPRs } from '@/lib/github';
import BranchMap from '@/components/BranchMap';
import { Branch, MergeNode, MergedPR } from '@/types';

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
  let fetchError: string | null = null;

  try {
    const result = await fetchBranches(owner, repo, token);
    branches = result.branches;
    defaultBranch = result.defaultBranch;
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

  const errorBranches = branches.filter(
    (b) => b.status === 'conflict-risk' || b.status === 'stale'
  );

  return (
    <div className="min-h-screen bg-[#F5F5F3]">
      <header className="flex items-center justify-between px-8 py-5">
        <Link href="/" className="text-stone-400 hover:text-stone-700 transition-colors text-sm">
          ← Back
        </Link>
        <h1 className="text-base font-medium text-stone-900 absolute left-1/2 -translate-x-1/2">
          {owner}/{repo}
        </h1>
        <div className="flex items-center gap-3">
          {errorBranches.length > 0 && (
            <span className="flex items-center gap-1.5 text-sm text-red-600 border border-red-200 rounded-full px-3 py-1 bg-white">
              ⚠ {errorBranches.length} branch error{errorBranches.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-stone-500 border border-stone-200 rounded-full px-3 py-1 bg-white">
            View: By time
          </span>
        </div>
      </header>

      {fetchError ? (
        <div className="flex items-center justify-center pt-32">
          <div className="text-center">
            <p className="text-stone-500 mb-2">Could not load repository</p>
            <p className="text-sm text-stone-400">{fetchError}</p>
          </div>
        </div>
      ) : (
        <div className="px-8 pt-4 pb-16">
          <BranchMap
            branches={branches}
            mergeNodes={mergeNodes}
            mergedPRs={mergedPRs}
            owner={owner}
            repo={repo}
            defaultBranch={defaultBranch}
            initialHasMore={initialHasMore}
          />
        </div>
      )}
    </div>
  );
}
