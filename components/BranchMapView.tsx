import { Branch, DirectCommit, MergeNode, MergedPR, OpenPR } from '../types';
import BranchMap from './BranchMap';
import BranchGroupView from './BranchGroupView';

export type ViewMode = 'time' | 'status' | 'creator';

interface Props {
  branches: Branch[];
  mergeNodes: MergeNode[];
  directCommits?: DirectCommit[];
  mergedPRs: MergedPR[];
  openPRs?: OpenPR[];
  defaultBranch: string;
  selectedBranch?: Branch | null;
  onBranchSelect?: (branch: Branch) => void;
  onBranchClick?: (branch: Branch) => void;
  onLoadMore?: () => void;
  githubAvailable?: boolean;
  githubOwner?: string | null;
  githubRepo?: string | null;
  view?: ViewMode;
  isLoading?: boolean;
  scrollRequest?: { branch: Branch; seq: number } | null;
  focusedErrorBranch?: Branch | null;
}

export default function BranchMapView({
  branches,
  mergeNodes,
  directCommits = [],
  mergedPRs,
  openPRs = [],
  defaultBranch,
  selectedBranch,
  onBranchSelect,
  onBranchClick,
  onLoadMore,
  githubOwner,
  githubRepo,
  view = 'time',
  isLoading = false,
  scrollRequest,
  focusedErrorBranch,
}: Props) {
  // Determine active vs inactive error branches
  const openPRBranchNames = new Set(openPRs.map(p => p.branchName));
  const ACTIVE_MS = 14 * 86400000;
  const viewNow = Date.now();
  function isBranchActive(b: Branch): boolean {
    return openPRBranchNames.has(b.name) || viewNow - new Date(b.lastCommitDate).getTime() <= ACTIVE_MS;
  }

  // Only active error branches get red/amber treatment
  const conflictBranches = branches
    .filter(b => b.status === 'conflict-risk' && isBranchActive(b))
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());
  const staleBranches = branches
    .filter(b => b.status === 'stale' && isBranchActive(b))
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());
  // Inactive error branches render grey (like merged branches)
  const inactiveErrorBranches = branches
    .filter(b => (b.status === 'conflict-risk' || b.status === 'stale') && !isBranchActive(b));

  return (
    <div className="h-full flex flex-col">
      {view === 'time' ? (
        <div className="flex-1 min-h-0">
          <BranchMap
            branches={branches}
            mergeNodes={mergeNodes}
            directCommits={directCommits}
            mergedPRs={mergedPRs}
            openPRs={openPRs}
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
            inactiveErrorBranches={inactiveErrorBranches}
            isLoading={isLoading}
            scrollRequest={scrollRequest}
            focusedErrorBranch={focusedErrorBranch}
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
