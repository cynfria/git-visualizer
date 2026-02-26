import Link from 'next/link';
import { ArrowLeft, TriangleAlert } from 'lucide-react';
import { fetchBranches, fetchBranchCommits, fetchChangedFiles } from '@/lib/github';
import DiffViewer from '@/components/DiffViewer';
import { PageHeader } from '@/components/PageHeader';
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
      <PageHeader
        left={
          <Link
            href={`/repo/${owner}/${repo}`}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
        }
        center={
          <h1 className="text-sm font-medium text-foreground">{owner}/{branch}</h1>
        }
        right={
          isOutOfDate ? (
            <span className="flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0" />
              Branch out of date
            </span>
          ) : undefined
        }
      />

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
