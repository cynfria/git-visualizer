import { Branch, BranchStatus } from '../types';
import { ViewMode } from './BranchMapView';

function timeAgo(dateStr: string) {
  const s = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function BranchCard({
  branch,
  accentColor,
  onClick,
}: {
  branch: Branch;
  accentColor: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="group rounded-xl border border-border bg-card p-4 flex flex-col gap-3 cursor-pointer hover:shadow-sm hover:border-border/80 transition-all"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-foreground leading-snug break-all">
          {branch.name}
        </span>
        <span
          className="shrink-0 w-2 h-2 rounded-full mt-1"
          style={{ background: accentColor }}
        />
      </div>

      <div className="flex items-center gap-2">
        {branch.lastCommitAuthorAvatar ? (
          <img
            src={branch.lastCommitAuthorAvatar}
            alt={branch.lastCommitAuthor}
            className="w-5 h-5 rounded-full shrink-0"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0">
            <span className="text-[10px] text-muted-foreground font-medium">
              {branch.lastCommitAuthor?.charAt(0).toUpperCase() || '?'}
            </span>
          </div>
        )}
        <span className="text-xs text-muted-foreground truncate">{branch.lastCommitAuthor}</span>
        <span className="text-xs text-muted-foreground ml-auto shrink-0">{timeAgo(branch.lastCommitDate)}</span>
      </div>

      {(branch.commitsAhead > 0 || branch.commitsBehind > 0) && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {branch.commitsAhead > 0 && (
            <span>+{branch.commitsAhead} ahead</span>
          )}
          {branch.commitsBehind > 0 && (
            <span>-{branch.commitsBehind} behind</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── By Status ────────────────────────────────────────────────────────────────

const STATUS_CONFIG: {
  status: BranchStatus;
  label: string;
  color: string;
  bg: string;
  description: string;
}[] = [
  {
    status: 'conflict-risk',
    label: 'Conflict risk',
    color: '#dc2626',
    bg: 'bg-red-900/10',
    description: 'Cannot be cleanly merged',
  },
  {
    status: 'stale',
    label: 'Stale',
    color: '#d97706',
    bg: 'bg-amber-900/10',
    description: 'No commits in 14+ days',
  },
  {
    status: 'fresh',
    label: 'Fresh',
    color: '#16a34a',
    bg: 'bg-green-900/10',
    description: 'Recently active',
  },
];

function StatusView({
  branches,
  defaultBranch,
  onBranchClick,
}: {
  branches: Branch[];
  defaultBranch: string;
  onBranchClick?: (branch: Branch) => void;
}) {
  const active = branches.filter(b => b.name !== defaultBranch && b.commitsAhead > 0);

  return (
    <div className="grid grid-cols-3 gap-6 items-start">
      {STATUS_CONFIG.map(({ status, label, color, bg, description }) => {
        const group = active.filter(b => b.status === status);
        return (
          <div key={status}>
            <div className={`rounded-xl ${bg} border border-border/50 px-4 py-3 mb-3`}>
              <div className="flex items-center gap-2 mb-0.5">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
                <span className="text-sm font-medium text-foreground">{label}</span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">{group.length}</span>
              </div>
              <p className="text-[10px] text-muted-foreground pl-4">{description}</p>
            </div>
            <div className="flex flex-col gap-2">
              {group.length === 0 ? (
                <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-6 text-center">
                  <p className="text-xs text-muted-foreground">No branches</p>
                </div>
              ) : (
                group.map(b => (
                  <BranchCard
                    key={b.name}
                    branch={b}
                    accentColor={color}
                    onClick={() => onBranchClick?.(b)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── By Creator ───────────────────────────────────────────────────────────────

function CreatorView({
  branches,
  defaultBranch,
  onBranchClick,
}: {
  branches: Branch[];
  defaultBranch: string;
  onBranchClick?: (branch: Branch) => void;
}) {
  const active = branches.filter(b => b.name !== defaultBranch && b.commitsAhead > 0);

  // Group by author, preserve most-recently-active author first
  const authorMap = new Map<string, Branch[]>();
  for (const b of active.sort(
    (a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime()
  )) {
    const author = b.lastCommitAuthor || 'Unknown';
    if (!authorMap.has(author)) authorMap.set(author, []);
    authorMap.get(author)!.push(b);
  }

  const STATUS_COLORS: Record<BranchStatus, string> = {
    'conflict-risk': '#dc2626',
    stale: '#d97706',
    fresh: '#16a34a',
    unknown: '#6b7280',
  };

  return (
    <div className="flex flex-col gap-8">
      {[...authorMap.entries()].map(([author, authorBranches]) => {
        const avatar = authorBranches[0]?.lastCommitAuthorAvatar;
        return (
          <div key={author}>
            {/* Author header */}
            <div className="flex items-center gap-3 mb-3">
              {avatar ? (
                <img src={avatar} alt={author} className="w-8 h-8 rounded-full shrink-0" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <span className="text-sm text-muted-foreground font-medium">
                    {author.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}
              <div>
                <p className="text-sm font-medium text-foreground">{author}</p>
                <p className="text-[10px] text-muted-foreground">
                  {authorBranches.length} branch{authorBranches.length !== 1 ? 'es' : ''}
                </p>
              </div>
            </div>

            {/* Branch cards grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pl-11">
              {authorBranches.map(b => (
                <BranchCard
                  key={b.name}
                  branch={b}
                  accentColor={STATUS_COLORS[b.status]}
                  onClick={() => onBranchClick?.(b)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {active.length === 0 && (
        <div className="rounded-xl bg-muted/30 shadow-inner flex items-center justify-center py-20">
          <p className="text-sm text-muted-foreground">No active branches</p>
        </div>
      )}
    </div>
  );
}

// ── Unified export ────────────────────────────────────────────────────────────

export default function BranchGroupView({
  view,
  branches,
  defaultBranch,
  onBranchClick,
}: {
  view: Exclude<ViewMode, 'time'>;
  branches: Branch[];
  defaultBranch: string;
  onBranchClick?: (branch: Branch) => void;
}) {
  if (view === 'status') {
    return <StatusView branches={branches} defaultBranch={defaultBranch} onBranchClick={onBranchClick} />;
  }
  return <CreatorView branches={branches} defaultBranch={defaultBranch} onBranchClick={onBranchClick} />;
}
