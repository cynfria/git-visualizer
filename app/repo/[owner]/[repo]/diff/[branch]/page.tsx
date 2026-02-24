import Link from 'next/link';
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
    <div className="min-h-screen bg-[#F5F5F3] flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 flex-shrink-0 relative">
        <Link
          href={`/repo/${owner}/${repo}`}
          className="text-stone-400 hover:text-stone-700 transition-colors text-sm"
        >
          ← Back
        </Link>
        <h1 className="text-base font-medium text-stone-900 absolute left-1/2 -translate-x-1/2">
          {owner}/{branch}
        </h1>
        {isOutOfDate && (
          <span className="flex items-center gap-1.5 text-sm text-red-600">
            ⚠ Branch out of date
          </span>
        )}
      </header>

      {/* Main 3-column layout */}
      <div className="flex-1 px-8 pb-8 min-h-0">
        <DiffViewer
          owner={owner}
          repo={repo}
          branch={branch}
          commits={commits}
          componentGroups={componentGroups}
          token={token}
        />
      </div>
    </div>
  );
}
