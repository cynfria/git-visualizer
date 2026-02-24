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
    <div className="min-h-screen bg-background">
      <header className="relative flex items-center justify-between px-8 py-4 border-b border-border/50">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors text-sm">
          ← Back
        </Link>
        <h1 className="text-sm font-medium text-foreground absolute left-1/2 -translate-x-1/2">
          {owner}/{repo}
        </h1>
        <div className="flex items-center gap-2">
          {errorBranches.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-destructive border border-destructive/20 rounded-full px-3 py-1 bg-destructive/5">
              ⚠ {errorBranches.length} branch error{errorBranches.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className="text-xs text-muted-foreground border border-border rounded-full px-3 py-1 bg-card">
            By time
          </span>
        </div>
      </header>

      {fetchError ? (
        <div className="flex items-center justify-center pt-32">
          <div className="text-center bg-muted/30 shadow-inner rounded-xl px-10 py-8">
            <p className="text-sm font-medium text-foreground mb-1">Could not load repository</p>
            <p className="text-sm text-muted-foreground">{fetchError}</p>
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
