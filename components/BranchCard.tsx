import { Branch } from '../types';
import StatusBadge from './StatusBadge';

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BranchCard({
  branch,
  onClick,
}: {
  branch: Branch;
  onClick?: () => void;
}) {
  const isError = branch.status === 'conflict-risk';

  return (
    <button
      onClick={onClick}
      className={`block w-full text-left group rounded-xl border bg-stone-800 p-4 transition-all hover:bg-stone-750 hover:border-stone-600 ${
        isError ? 'border-red-800' : 'border-stone-700'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`font-mono text-sm font-medium truncate ${isError ? 'text-red-400' : 'text-stone-100'}`}>
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
            className="w-5 h-5 rounded-full bg-stone-700"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-stone-600" />
        )}
        <span className="text-xs text-stone-500">{branch.lastCommitAuthor}</span>
      </div>

      {branch.mergeable === null && branch.name !== 'main' && (
        <p className="text-xs text-stone-600 mt-2 italic">Conflict status computing…</p>
      )}
    </button>
  );
}
