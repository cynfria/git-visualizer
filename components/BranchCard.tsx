'use client';

import Link from 'next/link';
import { Branch } from '@/types';
import StatusBadge from './StatusBadge';

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BranchCard({
  branch,
  owner,
  repo,
}: {
  branch: Branch;
  owner: string;
  repo: string;
}) {
  const isError = branch.status === 'conflict-risk';

  return (
    <Link
      href={`/repo/${owner}/${repo}/diff/${encodeURIComponent(branch.name)}`}
      className={`block group rounded-xl border bg-white p-4 transition-shadow hover:shadow-md ${
        isError ? 'border-red-200' : 'border-stone-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-mono text-sm font-medium truncate ${isError ? 'text-red-600' : 'text-stone-900'}`}>
            {branch.name}
          </p>
          <p className="text-xs text-stone-500 mt-1">
            +{branch.commitsAhead} commits · {formatDate(branch.lastCommitDate)}
          </p>
        </div>
        <StatusBadge status={branch.status} />
      </div>

      <div className="flex items-center gap-2 mt-3">
        {branch.lastCommitAuthorAvatar ? (
          <img
            src={branch.lastCommitAuthorAvatar}
            alt={branch.lastCommitAuthor}
            className="w-5 h-5 rounded-full bg-stone-200"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-stone-300" />
        )}
        <span className="text-xs text-stone-500">{branch.lastCommitAuthor}</span>
      </div>

      {branch.mergeable === null && branch.name !== 'main' && (
        <p className="text-xs text-stone-400 mt-2 italic">Conflict status computing…</p>
      )}
    </Link>
  );
}
