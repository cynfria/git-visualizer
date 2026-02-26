import { ChevronDown, Check } from 'lucide-react';
import { Branch, MergeNode, MergedPR } from '../types';
import { useState, useRef, useEffect } from 'react';
import BranchMap from './BranchMap';
import BranchGroupView from './BranchGroupView';

export type ViewMode = 'time' | 'status' | 'creator';

const VIEW_LABELS: Record<ViewMode, string> = {
  time: 'By time',
  status: 'By status',
  creator: 'By creator',
};

interface Props {
  branches: Branch[];
  mergeNodes: MergeNode[];
  mergedPRs: MergedPR[];
  defaultBranch: string;
  selectedBranch?: Branch | null;
  onBranchSelect?: (branch: Branch) => void;
  onBranchClick?: (branch: Branch) => void;
  onLoadMore?: () => void;
  githubAvailable?: boolean;
  githubOwner?: string | null;
  githubRepo?: string | null;
}

export default function BranchMapView({
  branches,
  mergeNodes,
  mergedPRs,
  defaultBranch,
  selectedBranch,
  onBranchSelect,
  onBranchClick,
  onLoadMore,
  githubAvailable = false,
  githubOwner,
  githubRepo,
}: Props) {
  const [view, setView] = useState<ViewMode>('time');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Only show "By creator" if we have GitHub data (author avatars come from GitHub)
  const availableViews: ViewMode[] = githubAvailable
    ? ['time', 'status', 'creator']
    : ['time', 'status'];

  // Extract error branches for the PR issues panel
  const conflictBranches = branches
    .filter(b => b.status === 'conflict-risk')
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());
  const staleBranches = branches
    .filter(b => b.status === 'stale')
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());

  return (
    <div className="h-full flex flex-col">
      {/* View selector */}
      <div className="flex justify-end px-4 py-2">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setDropdownOpen((o) => !o)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-full px-3 py-1 bg-card hover:bg-accent transition-colors"
          >
            {VIEW_LABELS[view]}
            <ChevronDown className="w-3 h-3 shrink-0" />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-36 bg-card border border-border rounded-xl shadow-lg py-1 z-50">
              {availableViews.map((v) => (
                <button
                  key={v}
                  onClick={() => { setView(v); setDropdownOpen(false); }}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-foreground hover:bg-accent transition-colors"
                >
                  {VIEW_LABELS[v]}
                  {view === v && <Check className="w-3 h-3 shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {view === 'time' ? (
        <div className="flex-1 min-h-0">
          <BranchMap
            branches={branches}
            mergeNodes={mergeNodes}
            mergedPRs={mergedPRs}
            defaultBranch={defaultBranch}
            selectedBranch={selectedBranch}
            onBranchSelect={onBranchSelect}
            onBranchClick={onBranchClick}
            onLoadMore={onLoadMore}
            githubOwner={githubOwner}
            githubRepo={githubRepo}
            view={view}
            conflictBranches={conflictBranches}
            staleBranches={staleBranches}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 px-4 pb-8 overflow-y-auto">
          <BranchGroupView
            view={view}
            branches={branches}
            defaultBranch={defaultBranch}
            onBranchClick={onBranchClick}
          />
        </div>
      )}
    </div>
  );
}
