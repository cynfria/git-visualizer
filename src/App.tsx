import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BranchMapView from '../components/BranchMapView';
import DiffViewer from '../components/DiffViewer';
import FolderPickerModal from './FolderPickerModal';
import type { Branch, DirectCommit, MergeNode, MergedPR, OpenPR, GitHubInfo } from '../types';

type View = 'landing' | 'map' | 'diff';

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mergeNodes, setMergeNodes] = useState<MergeNode[]>([]);
  const [directCommits, setDirectCommits] = useState<DirectCommit[]>([]);
  const [mergedPRs, setMergedPRs] = useState<MergedPR[]>([]);
  const [openPRs, setOpenPRs] = useState<OpenPR[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>('main');
  const [loading, setLoading] = useState(false);       // button spinner in landing
  const [mapLoading, setMapLoading] = useState(false); // canvas skeleton in map
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('landing');
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null);
  const [showErrorPanel, setShowErrorPanel] = useState(false);
  const [errorPanelClosing, setErrorPanelClosing] = useState(false);
  const [errorPanelTab, setErrorPanelTab] = useState<'active' | 'inactive'>('active');
  // scrollRequest.seq increments on each click so the same branch re-triggers the effect
  const [scrollRequest, setScrollRequest] = useState<{ branch: Branch; seq: number } | null>(null);
  const [focusedErrorBranch, setFocusedErrorBranch] = useState<Branch | null>(null);
  const [mapUiReady, setMapUiReady] = useState(false);
  const hadMapDataRef = useRef(false);
  const [githubAvailable, setGithubAvailable] = useState(false);
  const [githubOwner, setGithubOwner] = useState<string | null>(null);
  const [githubRepo, setGithubRepo] = useState<string | null>(null);

  // Pre-warm: screenshot main branch at '/' as soon as active branches load,
  // so DiffViewer can skip the main-side server start for the common case.
  const [prewarmedMainShots, setPrewarmedMainShots] = useState<(string | null)[] | null>(null);
  const prewarmedRef = useRef(false);
  const [prewarmedBranches, setPrewarmedBranches] = useState<Map<string, (string | null)[]>>(new Map());
  const prewarmedBranchRef = useRef<string | null>(null);
  const [authSetupLoading, setAuthSetupLoading] = useState(false);

  async function loadRepo(path: string) {
    setLoading(true);
    setMapLoading(true);
    setError(null);
    setBranches([]);
    setMergeNodes([]);
    setDirectCommits([]);
    setRepoPath(path);
    setRepoName(path.split('/').pop() || '');
    setView('map');

    try {
      // Phase 1: fast metadata — show the map shell immediately
      const [info, def] = await Promise.all([
        invoke<{ name: string; path: string }>('get_repo_info', { repoPath: path }),
        invoke<string>('get_default_branch', { repoPath: path }),
      ]);
      setRepoName(info.name);
      setDefaultBranch(def);
      setLoading(false); // unblock the landing button

      // Phase 2: heavier git data — timeline skeleton shows while this loads
      const [branchList, nodes, directResult] = await Promise.all([
        invoke<Branch[]>('get_branches', { repoPath: path }),
        invoke<{ nodes: MergeNode[]; hasMore: boolean }>('get_merge_nodes', {
          repoPath: path,
          branch: 'HEAD',
          page: 0,
          perPage: 100,
        }),
        invoke<DirectCommit[]>('get_direct_commits', {
          repoPath: path,
          branch: 'HEAD',
          limit: 300,
        }),
      ]);
      setBranches(branchList);
      setMergeNodes(nodes.nodes);
      setDirectCommits(directResult);
      setMapLoading(false);

      // Phase 3: GitHub data (non-blocking)
      fetchGitHubData(path, def);
    } catch (e) {
      console.error('Failed to load repo:', e);
      setError(e instanceof Error ? e.message : String(e));
      setView('landing');
      setRepoPath(null);
      setLoading(false);
      setMapLoading(false);
    }
  }

  async function fetchGitHubData(path: string, baseBranch: string) {
    try {
      const ghInfo = await invoke<GitHubInfo>('get_github_info', { repoPath: path });

      if (ghInfo.ghAvailable) {
        setGithubAvailable(true);
        setGithubOwner(ghInfo.owner);
        setGithubRepo(ghInfo.repo);
        // Fetch merged PRs and open PRs in parallel
        const [prs, open] = await Promise.all([
          invoke<MergedPR[]>('get_merged_prs', {
            owner: ghInfo.owner,
            repo: ghInfo.repo,
            baseBranch,
            limit: 50,
          }),
          invoke<OpenPR[]>('get_open_prs', {
            owner: ghInfo.owner,
            repo: ghInfo.repo,
          }),
        ]);
        setMergedPRs(prs);
        setOpenPRs(open);
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

  const openPRBranchNames = new Set(openPRs.map((p) => p.branchName));
  const ACTIVE_MS = 14 * 86400000;
  const now = Date.now();
  const errorBranches = branches.filter((b) => b.status === 'conflict-risk' || b.status === 'stale');
  const activeErrorBranches = errorBranches.filter(
    (b) => openPRBranchNames.has(b.name) || now - new Date(b.lastCommitDate).getTime() <= ACTIVE_MS
  );
  const inactiveErrorBranches = errorBranches.filter(
    (b) => !openPRBranchNames.has(b.name) && now - new Date(b.lastCommitDate).getTime() > ACTIVE_MS
  );

  // Mirror BranchMap's scrollbarReady timing so the error pill fades in together.
  // BranchMap fires drawReady after 2 rAFs (~33ms), then delays scrollbar 2600ms.
  useEffect(() => {
    if (mergeNodes.length === 0 || hadMapDataRef.current) return;
    hadMapDataRef.current = true;
    setMapUiReady(false);
    const id = setTimeout(() => setMapUiReady(true), 2650);
    return () => clearTimeout(id);
  }, [mergeNodes.length]);

  // Reset when a new repo is loaded
  useEffect(() => {
    hadMapDataRef.current = false;
    setMapUiReady(false);
    setPrewarmedMainShots(null);
    prewarmedRef.current = false;
    setPrewarmedBranches(new Map());
    prewarmedBranchRef.current = null;
    setAuthSetupLoading(false);
  }, [repoPath]);

  // Pre-warm: start screenshotting main at '/' as soon as active branches arrive.
  // Uses port 3495 (separate from DiffViewer's 3491/3492) to avoid conflicts.
  useEffect(() => {
    const activeBranches = branches.filter(b => b.commitsAhead > 0);
    if (!repoPath || !defaultBranch || activeBranches.length === 0) return;
    if (prewarmedRef.current) return;
    prewarmedRef.current = true;
    invoke<string[]>('generate_preview_routes', {
      repoPath,
      branch: defaultBranch,
      port: 3495,
      paths: ['/'],
    }).then(shots => {
      setPrewarmedMainShots(shots.map(s => (s.startsWith('data:') ? s : null)));
    }).catch(() => { /* silent — DiffViewer will fall back to fresh generation */ });
  }, [repoPath, defaultBranch, branches.length]);

  // Pre-warm: screenshot all active branches sequentially in the background.
  // Uses port 3496 (one at a time) to avoid port conflicts.
  // Results are stored by branch name — used instantly when user clicks.
  useEffect(() => {
    const activeBranches = branches.filter(b => b.commitsAhead > 0);
    if (!repoPath || activeBranches.length === 0) return;
    const key = activeBranches.map(b => b.name).join(',');
    if (prewarmedBranchRef.current === key) return;
    prewarmedBranchRef.current = key;
    setPrewarmedBranches(new Map());
    let cancelled = false;
    (async () => {
      for (const b of activeBranches) {
        if (cancelled) break;
        try {
          const shots = await invoke<string[]>('generate_preview_routes', {
            repoPath,
            branch: b.name,
            fallbackSha: b.headSha || null,
            port: 3496,
            paths: ['/'],
          });
          if (!cancelled) {
            setPrewarmedBranches(prev => new Map(prev).set(b.name, shots.map(s => s.startsWith('data:') ? s : null)));
          }
        } catch { /* silent */ }
      }
    })();
    return () => { cancelled = true; };
  }, [repoPath, branches.length]);

  // ── Cmd+Shift+S: capture screenshots of main timeline + every branch detail ──
  useEffect(() => {
    if (!repoPath || branches.length === 0) return;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const sanitize = (s: string) => s.replace(/[/\\:*?"<>|]/g, '-');

    async function captureScreenshots() {
      const homeDir = await invoke<string>('get_home_dir');
      const outDir = `${homeDir}/Desktop/git-viz-screenshots/${repoName}`;
      console.log(`📸 Saving screenshots to ${outDir}`);

      // 1. Main timeline
      setSelectedBranch(null);
      setView('map');
      await sleep(800);
      await invoke('screenshot', { path: `${outDir}/main-timeline.png` });
      console.log('  ✓ main-timeline.png');

      // 2. Each branch detail page
      for (const branch of branches) {
        setSelectedBranch(branch);
        setView('diff');
        await sleep(1200); // wait for commits to load
        await invoke('screenshot', { path: `${outDir}/${sanitize(branch.name)}.png` });
        console.log(`  ✓ ${sanitize(branch.name)}.png`);
      }

      // Back to map
      setSelectedBranch(null);
      setView('map');
      console.log(`📸 Done — ${branches.length + 1} screenshots saved to ${outDir}`);
    }

    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
        captureScreenshots();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [repoPath, repoName, branches]);

  function closeErrorPanel() {
    setErrorPanelClosing(true);
    setTimeout(() => {
      setShowErrorPanel(false);
      setErrorPanelClosing(false);
      setErrorPanelTab('active');
      setFocusedErrorBranch(null);
    }, 100);
  }

  function handleBranchSelect(branch: Branch) {
    setSelectedBranch(branch);
    setView('diff');
  }

  function handleBranchClick(branch: Branch) {
    setSelectedBranch(branch);
    setView('diff');
  }

  function handleFocusOnMap(branch: Branch) {
    setSelectedBranch(null);
    setView('map');
    setFocusedErrorBranch(branch);
    setScrollRequest(prev => ({ branch, seq: (prev?.seq ?? 0) + 1 }));
    // panel stays open intentionally
  }

  function handleViewDiff() {
    if (selectedBranch) {
      setView('diff');
    }
  }

  function handleBackToMap() {
    setSelectedBranch(null);
    setView('map');
  }

  // True when pre-warm finished but root route is auth-gated (all shots null)
  const previewIsAuthGated =
    prewarmedMainShots !== null && prewarmedMainShots.every(s => s === null);

  async function handleAuthSetup() {
    if (!repoPath) return;
    setAuthSetupLoading(true);
    try {
      await invoke('open_preview_browser', { repoPath, branch: defaultBranch });
    } catch (e) {
      console.error('Auth setup failed:', e);
    }
    setAuthSetupLoading(false);
    // Re-run pre-warm so updated auth is reflected in DiffViewer
    prewarmedRef.current = false;
    setPrewarmedMainShots(null);
  }

  function handleBackToLanding() {
    setRepoPath(null);
    setMergedPRs([]);
    setOpenPRs([]);
    setDirectCommits([]);
    setGithubAvailable(false);
    setView('landing');
  }

  return (
    <div className="h-screen bg-background text-foreground flex flex-col">
      <div className={view !== 'landing' ? 'hidden' : 'contents'}>
        <RepoSelector onSelect={loadRepo} loading={loading} error={error} />
      </div>

      {/* Map + Diff share a container — hidden only during landing.
          Map↔Diff transitions use visibility (not display) so CSS animations don't reset. */}
      <div className={`flex-1 overflow-hidden relative ${view === 'landing' ? 'hidden' : ''}`}>

        {/* Map view */}
        <div className={`absolute inset-0 flex flex-col ${view !== 'map' ? 'invisible pointer-events-none' : ''}`}>
          <header className="flex items-center justify-between px-8 py-5">
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
              {(previewIsAuthGated || authSetupLoading) && (
                <button
                  onClick={handleAuthSetup}
                  disabled={authSetupLoading}
                  className="text-xs text-muted-foreground hover:text-foreground border border-border/50 rounded-full px-3 py-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {authSetupLoading ? 'Log in and close Chrome...' : 'Authenticate Preview'}
                </button>
              )}
              {activeErrorBranches.length > 0 && (
                <button
                  onClick={() => { if (showErrorPanel) { closeErrorPanel(); } else { setShowErrorPanel(true); } }}
                  style={{ opacity: mapUiReady ? 1 : 0, transition: 'opacity 0.4s ease, background-color 0.2s ease, border-color 0.2s ease' }}
                  className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1 ${
                    showErrorPanel
                      ? 'text-destructive border-destructive/40 bg-destructive/10'
                      : 'text-destructive border-destructive/20 bg-destructive/5 hover:bg-destructive/10'
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                  {activeErrorBranches.length} active error{activeErrorBranches.length !== 1 ? 's' : ''}
                </button>
              )}

            </div>
          </header>

          {/* Branch errors floating panel */}
          {showErrorPanel && (
            <div className={`absolute top-[65px] right-6 z-50 w-80 bg-card border border-border rounded-2xl shadow-lg overflow-hidden ${errorPanelClosing ? 'animate-error-panel-out' : 'animate-error-panel-in'}`}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
                <span className="text-sm font-medium text-foreground">Branch errors</span>
                <button
                  onClick={closeErrorPanel}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border/30 bg-muted/30">
                <button
                  onClick={() => setErrorPanelTab('active')}
                  className={`text-xs font-medium transition-colors ${errorPanelTab === 'active' ? 'text-destructive' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {activeErrorBranches.length} active
                </button>
                <span className="text-xs text-muted-foreground">·</span>
                <button
                  onClick={() => setErrorPanelTab('inactive')}
                  className={`text-xs font-medium transition-colors ${errorPanelTab === 'inactive' ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {inactiveErrorBranches.length} inactive
                </button>
              </div>
              <div className="overflow-y-auto max-h-64">
                {(errorPanelTab === 'active' ? activeErrorBranches : inactiveErrorBranches).map((b) => {
                  const isFocused = focusedErrorBranch?.name === b.name;
                  return (
                    <button
                      key={b.name}
                      onClick={() => handleFocusOnMap(b)}
                      className={`w-full flex items-start gap-2 py-3 border-b border-border/30 last:border-0 hover:bg-accent transition-colors text-left ${
                        isFocused
                          ? b.status === 'conflict-risk'
                            ? 'bg-red-50/60 dark:bg-red-900/10 px-4'
                            : 'bg-amber-50/60 dark:bg-amber-900/10 px-4'
                          : 'px-4'
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${
                          isFocused
                            ? b.status === 'conflict-risk' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'
                            : 'text-foreground'
                        }`}>{b.name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {b.commitsAhead > 0 && `${b.commitsAhead} ahead`}
                          {b.commitsAhead > 0 && b.commitsBehind > 0 && ', '}
                          {b.commitsBehind > 0 && `${b.commitsBehind} behind`}
                        </p>
                      </div>
                      <span className={`text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full shrink-0 mt-0.5 ${
                        b.status === 'conflict-risk'
                          ? 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                          : 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400'
                      }`}>
                        {b.status === 'conflict-risk' ? 'Conflict' : 'Stale'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            <BranchMapView
              branches={branches}
              mergeNodes={mergeNodes}
              directCommits={directCommits}
              mergedPRs={mergedPRs}
              openPRs={openPRs}
              defaultBranch={defaultBranch}
              selectedBranch={selectedBranch}
              onBranchSelect={handleBranchSelect}
              onBranchClick={handleBranchClick}
              onLoadMore={loadMoreNodes}
              githubAvailable={githubAvailable}
              githubOwner={githubOwner}
              githubRepo={githubRepo}
              view="time"
              isLoading={mapLoading}
              scrollRequest={scrollRequest}
              focusedErrorBranch={focusedErrorBranch}
            />
          </div>
        </div>

        {/* Diff view */}
        {repoPath && selectedBranch && (
          <div className={`absolute inset-0 flex flex-col transition-opacity duration-150 ${view !== 'diff' ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
            <DiffViewer
              key={selectedBranch.name}
              repoPath={repoPath}
              branch={selectedBranch}
              defaultBranch={defaultBranch}
              mergedPR={mergedPRs.find(p => p.branchName === selectedBranch.name)}
              prewarmedMainShots={prewarmedMainShots}
              prewarmedBranchShots={prewarmedBranches.get(selectedBranch.name) ?? null}
              onBack={handleBackToMap}
            />
          </div>
        )}

      </div>
    </div>
  );
}

function InteractiveDotField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouse = useRef({ x: -9999, y: -9999 });
  const raf = useRef(0);
  const dots = useRef<{ x: number; y: number; phase: number }[]>([]);

  useEffect(() => {
    const rawCanvas = canvasRef.current;
    if (!rawCanvas) return;
    const canvas: HTMLCanvasElement = rawCanvas;
    const ctx = canvas.getContext('2d')!;
    const SPACING = 20;

    function buildDots(w: number, h: number) {
      const arr: { x: number; y: number; phase: number }[] = [];
      const cols = Math.floor(w / SPACING);
      const rows = Math.floor(h / SPACING);
      const ox = (w - cols * SPACING) / 2;
      const oy = (h - rows * SPACING) / 2;
      for (let r = 0; r <= rows; r++) {
        for (let c = 0; c <= cols; c++) {
          arr.push({ x: ox + c * SPACING, y: oy + r * SPACING, phase: Math.random() * Math.PI * 2 });
        }
      }
      dots.current = arr;
    }

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildDots(w, h);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function draw(t: number) {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      ctx.clearRect(0, 0, w, h);
      const mx = mouse.current.x;
      const my = mouse.current.y;
      const INFLUENCE = 160;
      const MAX_PUSH  = 28;

      for (const d of dots.current) {
        const pulse = 0.1 + 0.22 * Math.sin(t * 0.0005 + d.phase);
        const ddx = d.x - mx;
        const ddy = d.y - my;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy);
        const prox = Math.max(0, 1 - dist / INFLUENCE);

        // Repel: push dot away from cursor
        const force = Math.pow(prox, 2) * MAX_PUSH;
        const drawX = dist > 0 ? d.x + (ddx / dist) * force : d.x;
        const drawY = dist > 0 ? d.y + (ddy / dist) * force : d.y;

        const opacity = pulse + prox * 0.4;
        const r = 1.3 + prox * 1.2;

        ctx.beginPath();
        ctx.arc(drawX, drawY, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(168, 162, 158, ${opacity})`;
        ctx.fill();
      }

      raf.current = requestAnimationFrame(draw);
    }

    raf.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf.current);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }}
      onMouseLeave={() => { mouse.current = { x: -9999, y: -9999 }; }}
    />
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
      <div className="w-[26%] relative flex-shrink-0 bg-muted overflow-hidden">
        <InteractiveDotField />
      </div>

      {/* Right content panel */}
      <div className="flex-1 flex flex-col justify-center px-16 bg-background">
        <p className="font-light text-foreground w-[60%]" style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: '48px', lineHeight: 1 }}>Git visualizer</p>
        <h1 className="font-light text-muted-foreground mb-14 w-[60%]" style={{ fontFamily: 'var(--font-space-grotesk)', fontSize: '48px', lineHeight: 1.08 }}>
          See what your team is building, without reading a line of code.
        </h1>

        <p className="text-sm text-muted-foreground mb-4">Get started</p>

        <div className="flex flex-col gap-3 w-64">
          <button
            onClick={() => setShowPicker(true)}
            className="px-6 py-3 border border-border bg-card text-foreground text-sm hover:bg-accent transition-colors text-center rounded-2xl"
          >
            Browse for repository
          </button>

          {!showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="px-6 py-3 border border-border bg-card text-foreground text-sm hover:bg-accent transition-colors text-center rounded-2xl"
            >
              Enter repo path
            </button>
          ) : (
            <div className="flex flex-col gap-2 animate-pill-expand">
              <form
                onSubmit={(e) => { e.preventDefault(); path && onSelect(path); }}
                className="flex items-center rounded-2xl border border-border bg-card"
              >
                {/* Input with left-edge gradient fade for overflow text */}
                <div className="relative flex-1 min-w-0 overflow-hidden rounded-l-2xl">
                  <input
                    autoFocus
                    type="text"
                    value={path}
                    onChange={(e) => setPath(e.target.value)}
                    placeholder="Enter link"
                    className="w-full pl-5 pr-2 py-3.5 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  <div
                    className="absolute left-0 inset-y-0 w-10 pointer-events-none"
                    style={{ background: 'linear-gradient(to right, var(--card), transparent)' }}
                  />
                </div>
                <button
                  type="submit"
                  disabled={!path || loading}
                  className="m-1.5 w-10 h-10 rounded-[14px] bg-foreground text-background flex items-center justify-center shrink-0 hover:opacity-80 transition-opacity disabled:opacity-30"
                >
                  {loading ? (
                    <div className="w-3.5 h-3.5 border-2 border-background/30 border-t-background rounded-full animate-spin" />
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </form>
              {error && <p className="text-xs text-destructive px-2">{error}</p>}
            </div>
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
