import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BranchMapView from '../components/BranchMapView';
import DiffViewer from '../components/DiffViewer';
import FolderPickerModal from './FolderPickerModal';
import type { Branch, MergeNode, MergedPR, GitHubInfo } from '../types';

type View = 'landing' | 'map' | 'diff';

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mergeNodes, setMergeNodes] = useState<MergeNode[]>([]);
  const [mergedPRs, setMergedPRs] = useState<MergedPR[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>('main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('landing');
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [githubAvailable, setGithubAvailable] = useState(false);

  async function loadRepo(path: string) {
    setLoading(true);
    setError(null);
    try {
      const [info, def, branchList, nodes] = await Promise.all([
        invoke<{ name: string; path: string }>('get_repo_info', { repoPath: path }),
        invoke<string>('get_default_branch', { repoPath: path }),
        invoke<Branch[]>('get_branches', { repoPath: path }),
        invoke<{ nodes: MergeNode[]; hasMore: boolean }>('get_merge_nodes', {
          repoPath: path,
          branch: 'HEAD',
          page: 0,
          perPage: 100,
        }),
      ]);
      setRepoName(info.name);
      setDefaultBranch(def);
      setBranches(branchList);
      setMergeNodes(nodes.nodes);
      setRepoPath(path);
      setView('map');

      // Try to fetch GitHub data (non-blocking)
      fetchGitHubData(path, def);
    } catch (e) {
      console.error('Failed to load repo:', e);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }

  async function fetchGitHubData(path: string, baseBranch: string) {
    try {
      const ghInfo = await invoke<GitHubInfo>('get_github_info', { repoPath: path });

      if (ghInfo.ghAvailable) {
        setGithubAvailable(true);
        // Fetch merged PRs
        const prs = await invoke<MergedPR[]>('get_merged_prs', {
          owner: ghInfo.owner,
          repo: ghInfo.repo,
          baseBranch,
          limit: 50,
        });
        setMergedPRs(prs);
      }
    } catch (e) {
      // GitHub data is optional, don't show error to user
      console.log('GitHub data not available:', e);
    }
  }

  async function loadMoreNodes() {
    if (!repoPath) return;
    const currentPage = Math.floor(mergeNodes.length / 100);
    try {
      const result = await invoke<{ nodes: MergeNode[]; hasMore: boolean }>('get_merge_nodes', {
        repoPath,
        branch: 'HEAD',
        page: currentPage,
        perPage: 100,
      });
      setMergeNodes((prev) => [...prev, ...result.nodes]);
    } catch (e) {
      console.error('Failed to load more nodes:', e);
    }
  }

  const errorBranches = branches.filter(
    (b) => b.status === 'conflict-risk' || b.status === 'stale'
  );

  function handleBranchSelect(branch: Branch) {
    setSelectedBranch((prev) => (prev?.name === branch.name ? null : branch));
  }

  function handleBranchClick(branch: Branch) {
    setSelectedBranch(branch);
    setView('diff');
  }

  function handleViewDiff() {
    if (selectedBranch) {
      setView('diff');
    }
  }

  function handleBackToMap() {
    setView('map');
  }

  function handleBackToLanding() {
    setRepoPath(null);
    setMergedPRs([]);
    setGithubAvailable(false);
    setView('landing');
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      {view === 'landing' && (
        <RepoSelector onSelect={loadRepo} loading={loading} error={error} />
      )}

      {view === 'map' && repoPath && (
        <>
          <header className="flex items-center justify-between px-8 py-5 border-b border-border">
            <button
              onClick={handleBackToLanding}
              className="text-muted-foreground hover:text-foreground transition-colors text-sm"
            >
              ← Back
            </button>
            <h1 className="text-base font-medium text-foreground absolute left-1/2 -translate-x-1/2">
              {repoName}
            </h1>
            <div className="flex items-center gap-3">
              {selectedBranch && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-cyan-400 border border-cyan-800 rounded-full px-3 py-1 bg-cyan-950/50">
                    {selectedBranch.name}
                  </span>
                  <button
                    onClick={handleViewDiff}
                    className="text-sm text-foreground border border-border rounded-full px-3 py-1 bg-card hover:bg-accent transition-colors"
                  >
                    View diff →
                  </button>
                  <button
                    onClick={() => setSelectedBranch(null)}
                    className="text-muted-foreground hover:text-foreground text-sm"
                  >
                    ✕
                  </button>
                </div>
              )}
              {errorBranches.length > 0 && (
                <span className="flex items-center gap-1.5 text-sm text-destructive border border-destructive/20 rounded-full px-3 py-1 bg-destructive/5">
                  ⚠ {errorBranches.length} branch error{errorBranches.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </header>
          <div className="flex-1 overflow-hidden">
            <BranchMapView
              branches={branches}
              mergeNodes={mergeNodes}
              mergedPRs={mergedPRs}
              defaultBranch={defaultBranch}
              selectedBranch={selectedBranch}
              onBranchSelect={handleBranchSelect}
              onBranchClick={handleBranchClick}
              onLoadMore={loadMoreNodes}
              githubAvailable={githubAvailable}
            />
          </div>
        </>
      )}

      {view === 'diff' && repoPath && selectedBranch && (
        <DiffViewer
          repoPath={repoPath}
          branch={selectedBranch}
          defaultBranch={defaultBranch}
          onBack={handleBackToMap}
        />
      )}
    </div>
  );
}

// Decorative dot circle component
function DotCircle({ size, left, top }: { size: number; left: string; top: string }) {
  const r = size / 2;
  const spacing = 9;
  const dots: { x: number; y: number; opacity: number }[] = [];

  for (let x = -r; x <= r; x += spacing) {
    for (let y = -r; y <= r; y += spacing) {
      const dist = Math.sqrt(x * x + y * y);
      if (dist <= r) {
        dots.push({ x, y, opacity: 1 - (dist / r) * 0.75 });
      }
    }
  }

  return (
    <div className="absolute" style={{ left, top, transform: 'translate(-50%, -50%)' }}>
      <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={1.3} fill="#57534e" opacity={d.opacity * 0.6} />
        ))}
      </svg>
    </div>
  );
}

function RepoSelector({
  onSelect,
  loading,
  error,
}: {
  onSelect: (path: string) => void;
  loading: boolean;
  error: string | null;
}) {
  const [path, setPath] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showInput, setShowInput] = useState(false);

  function handlePickerSelect(selectedPath: string) {
    setShowPicker(false);
    onSelect(selectedPath);
  }

  return (
    <main className="flex h-full overflow-hidden">
      {/* Left decorative panel */}
      <div className="w-[42%] relative flex-shrink-0 bg-[#111] overflow-hidden">
        <DotCircle size={320} left="38%" top="34%" />
        <DotCircle size={280} left="52%" top="68%" />
        <div
          className="absolute text-[9px] text-muted-foreground tracking-widest font-mono leading-4"
          style={{ top: '44%', left: '58%', transform: 'rotate(90deg)', transformOrigin: 'left top' }}
        >
          59.9139°N<br />10.7522°E
        </div>
      </div>

      {/* Right content panel */}
      <div className="flex-1 flex flex-col justify-center px-16 bg-background">
        <p className="text-sm text-muted-foreground mb-3 tracking-wide">Git visualizer</p>
        <h1 className="text-[2.5rem] font-bold leading-[1.15] text-foreground mb-14 max-w-xs">
          See what your team is building, without reading a line of code.
        </h1>

        <p className="text-sm text-muted-foreground mb-4">Get started</p>

        <div className="flex flex-col gap-3 w-64">
          <button
            onClick={() => setShowPicker(true)}
            className="px-6 py-3 border border-foreground text-foreground text-sm hover:bg-foreground hover:text-background transition-colors text-center"
          >
            Browse for repository
          </button>

          {!showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="px-6 py-3 border border-foreground text-foreground text-sm hover:bg-foreground hover:text-background transition-colors text-center"
            >
              Enter repo path
            </button>
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); path && onSelect(path); }} className="flex flex-col gap-2">
              <input
                autoFocus
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="/path/to/repository"
                className="px-4 py-3 border border-border bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none focus:border-foreground"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button
                type="submit"
                disabled={!path || loading}
                className="px-6 py-3 bg-foreground text-background text-sm hover:bg-muted-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading...' : 'Open repository →'}
              </button>
            </form>
          )}
        </div>
      </div>

      {showPicker && (
        <FolderPickerModal
          onSelect={handlePickerSelect}
          onClose={() => setShowPicker(false)}
        />
      )}
    </main>
  );
}

export default App;
