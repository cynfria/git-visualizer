import Link from 'next/link';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { fetchBranches, fetchBranchCommits, fetchChangedFiles } from '@/lib/github';
import DiffViewer from '@/components/DiffViewer';
import type { Commit, ComponentGroup } from '@/types';

interface Props {
  params: Promise<{ owner: string; repo: string; branch: string }>;
}

export default async function DiffPage({ params }: Props) {
  const { owner, repo, branch: encodedBranch } = await params;
  const branch = decodeURIComponent(encodedBranch);

  const token = process.env.GITHUB_PAT;

  let commits: Commit[] = [];
  let componentGroups: ComponentGroup[] = [];
  let branchData = null;
  let defaultBranch = 'main';

  try {
    const { branches, defaultBranch: db } = await fetchBranches(owner, repo, token);
    defaultBranch = db;
    branchData = branches.find((b) => b.name === branch) ?? null;
    commits = await fetchBranchCommits(owner, repo, branch, defaultBranch, token);
    const { groups } = await fetchChangedFiles(owner, repo, branch, defaultBranch, token);
    componentGroups = groups;
  } catch {}

  const isOutOfDate = branchData?.commitsBehind && branchData.commitsBehind > 0;

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="relative flex items-center justify-between px-8 py-4 shrink-0 border-b border-border/50">
        <Link
          href={`/repo/${owner}/${repo}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-sm font-medium text-foreground absolute left-1/2 -translate-x-1/2">
          {owner}/{branch}
        </h1>
        {isOutOfDate ? (
          <span className="flex items-center gap-1.5 text-xs text-destructive">
            <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
            Branch out of date
          </span>
        ) : (
          <div />
        )}
      </header>

      <div className="flex-1 min-h-0 px-6 py-6">
        <DiffViewer
          owner={owner}
          repo={repo}
          branch={branch}
          commits={commits}
          componentGroups={componentGroups}
        />
      </div>
    </div>
  );
}
