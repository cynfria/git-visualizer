import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Branch, Commit, MergedPR } from '../types';

function timeAgo(dateStr: string) {
  const s = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface SummaryChange {
  type: 'add' | 'remove';
  description: string;
}

interface SummarySection {
  section: string;
  changes: SummaryChange[];
}

// A single before/after screenshot pair for one URL route.

function PreviewPanel({ title, src, loading, error, noVisualChanges }: {
  title: string;
  src: string | null;
  loading: boolean;
  error: string | null;
  noVisualChanges?: boolean;
}) {
  const [imgVisible, setImgVisible] = useState(false);

  // Reset fade state when src changes so each new screenshot fades in fresh
  const prevSrc = useRef<string | null>(null);
  if (src !== prevSrc.current) {
    prevSrc.current = src;
    if (src) setImgVisible(false);
  }

  return (
    <div className="flex-1 min-w-0 rounded-2xl bg-card border border-border flex flex-col overflow-hidden">
      <div className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-border/50 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
        {noVisualChanges && (
          <div className="shrink-0 bg-muted rounded-full px-2.5 py-1 flex items-center">
            <span className="text-[11px] text-muted-foreground leading-none">No visual changes</span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-auto">
        {src ? (
          <img
            src={src}
            alt={title}
            className={`w-full transition-opacity duration-500 ${imgVisible ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setImgVisible(true)}
          />
        ) : loading ? (
          <div className="animate-pulse p-4 space-y-3">
            <div className="h-5 bg-muted rounded w-1/3" />
            <div className="h-32 bg-muted rounded-lg w-full" />
            <div className="space-y-2">
              <div className="h-3 bg-muted rounded w-full" />
              <div className="h-3 bg-muted rounded w-5/6" />
              <div className="h-3 bg-muted rounded w-2/3" />
            </div>
            <div className="h-24 bg-muted rounded-lg w-full" />
          </div>
        ) : error ? (
          error.includes('not a valid object name') || error.includes('git archive failed') ? (
            <div className="h-full flex items-center justify-center px-8">
              <div className="text-center space-y-1.5">
                <p className="text-sm font-medium text-foreground">Preview unavailable</p>
                <p className="text-xs text-muted-foreground">This branch was deleted after merging and can no longer be checked out.</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-40 px-5">
              <p className="text-xs text-destructive text-center">{error}</p>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-40">
            <p className="text-xs text-muted-foreground italic">No preview available</p>
          </div>
        )}
      </div>
    </div>
  );
}

interface DiffViewerProps {
  repoPath: string;
  branch: Branch;
  defaultBranch: string;
  mergedPR?: MergedPR;
  onBack: () => void;
  prewarmedMainShots?: (string | null)[] | null;
  prewarmedBranchShots?: (string | null)[] | null;
}

export default function DiffViewer({
  repoPath,
  branch,
  defaultBranch,
  mergedPR,
  onBack,
  prewarmedMainShots,
  prewarmedBranchShots,
}: DiffViewerProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(true);
  const [summary, setSummary] = useState<SummarySection[] | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryState, setSummaryState] = useState<'loading' | 'done' | 'no-diff' | 'no-key' | 'git-error' | 'api-error' | 'parse-error'>('loading');
  const [apiErrorDetail, setApiErrorDetail] = useState<string | null>(null);
  const [panelView, setPanelView] = useState<'summary' | 'commits'>('summary');

  // Preview state — one entry per detected route
  const [routes, setRoutes] = useState<string[]>(['/']);
  const [mainShots, setMainShots] = useState<(string | null)[]>([]);
  const [branchShots, setBranchShots] = useState<(string | null)[]>([]);
  const [mainLoading, setMainLoading] = useState(true);
  const [branchLoading, setBranchLoading] = useState(true);
  const [mainError, setMainError] = useState<string | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);

  const [authSetupLoading, setAuthSetupLoading] = useState(false);
  const [showOutOfDateTooltip, setShowOutOfDateTooltip] = useState(false);

  // Close out-of-date tooltip on outside click
  useEffect(() => {
    if (!showOutOfDateTooltip) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('[data-ood-tooltip]')) setShowOutOfDateTooltip(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showOutOfDateTooltip]);

  // Generation counter: prevents React StrictMode double-invocation races.
  // If a newer call starts while an older one is still awaiting Rust, the older
  // call checks this ref after each await and bails if it's been superseded.
  const genRef = useRef(0);
  // StrictMode fires effects twice within ~10ms. Deduplicate rapid calls so
  // both preview runs don't race on the same temp directory and corrupt it.
  const lastPreviewStartRef = useRef(0);

  useEffect(() => {
    generatePreviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, branch.name, defaultBranch]);

  useEffect(() => {
    async function loadCommits() {
      setCommitsLoading(true);
      try {
        const mergeCommitSha = branch.commitsAhead === 0 && mergedPR?.mergeCommitSha
          ? mergedPR.mergeCommitSha
          : undefined;
        const result = await invoke<Commit[]>('get_branch_commits', {
          repoPath,
          branch: branch.name,
          baseBranch: defaultBranch,
          mergeCommitSha,
        });
        setCommits(result);
      } catch {
        setCommits([]);
      }
      setCommitsLoading(false);
    }

    async function loadDiffSummary() {
      setSummaryLoading(true);
      const mergeCommitSha = branch.commitsAhead === 0 && mergedPR?.mergeCommitSha
        ? mergedPR.mergeCommitSha
        : undefined;

      let diff: string;
      let apiKey: string | null;
      try {
        [diff, apiKey] = await Promise.all([
          invoke<string>('get_branch_diff', {
            repoPath,
            branch: branch.name,
            baseBranch: defaultBranch,
            mergeCommitSha,
          }),
          invoke<string | null>('get_anthropic_key'),
        ]);
      } catch (e) {
        console.log('Diff load failed:', e);
        setSummaryState('git-error');
        setSummaryLoading(false);
        return;
      }

      if (!diff.trim()) {
        setSummaryState('no-diff');
        setSummaryLoading(false);
        return;
      }
      if (!apiKey) {
        setSummaryState('no-key');
        setSummaryLoading(false);
        return;
      }

      let text: string;
      try {
        text = await invoke<string>('summarize_diff', { diff, apiKey });
      } catch (e) {
        console.log('Summarize failed:', e);
        setApiErrorDetail(String(e));
        setSummaryState('api-error');
        setSummaryLoading(false);
        return;
      }

      try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error('No JSON array in response');
        const parsed: SummarySection[] = JSON.parse(jsonMatch[0]);
        setSummary(parsed);
        setSummaryState('done');
      } catch (e) {
        console.log('Summary parse failed:', e);
        setSummaryState('parse-error');
      }
      setSummaryLoading(false);
    }

    loadCommits();
    loadDiffSummary();
  }, [repoPath, branch.name, defaultBranch]);

  async function generatePreviews() {
    const now = Date.now();
    if (now - lastPreviewStartRef.current < 50) return;
    lastPreviewStartRef.current = now;
    const gen = ++genRef.current;

    setMainShots([]);
    setBranchShots([]);
    setMainError(null);
    setBranchError(null);
    setMainLoading(true);
    setBranchLoading(true);

    // Detect which URL routes this branch's diff most likely affects.
    let detectedRoutes: string[] = ['/'];
    try {
      const r = await invoke<string[]>('get_changed_routes', {
        repoPath,
        branch: branch.name,
        baseBranch: defaultBranch,
      });
      if (r.length > 0) detectedRoutes = r;
    } catch { /* fall through to root */ }

    if (gen !== genRef.current) return; // superseded by a newer call
    setRoutes(detectedRoutes);

    // Use pre-warmed screenshots if they cover exactly the detected routes (['/'])
    const canUseMainPrewarm =
      prewarmedMainShots != null &&
      detectedRoutes.length === 1 &&
      detectedRoutes[0] === '/';
    const canUseBranchPrewarm =
      prewarmedBranchShots != null &&
      detectedRoutes.length === 1 &&
      detectedRoutes[0] === '/';

    // Fire main and branch in parallel. Use prewarmed shots when available.
    const mainPromise: Promise<string[]> = canUseMainPrewarm
      ? Promise.resolve(prewarmedMainShots!.map(s => s ?? ''))
      : invoke<string[]>('generate_preview_routes', {
          repoPath,
          branch: defaultBranch,
          port: 3491,
          paths: detectedRoutes,
        });

    const branchPromise: Promise<string[]> = canUseBranchPrewarm
      ? Promise.resolve(prewarmedBranchShots!.map(s => s ?? ''))
      : invoke<string[]>('generate_preview_routes', {
          repoPath,
          branch: branch.name,
          fallbackSha: branch.headSha || null,
          port: 3492,
          paths: detectedRoutes,
        });

    // Update each side as soon as it finishes (don't wait for the other)
    mainPromise
      .then(shots => {
        if (gen !== genRef.current) return;
        setMainShots(shots.map(s => (s.startsWith('data:') ? s : null)));
      })
      .catch(e => {
        if (gen !== genRef.current) return;
        setMainError(String(e));
        setMainShots(detectedRoutes.map(() => null));
      })
      .finally(() => { if (gen === genRef.current) setMainLoading(false); });

    branchPromise
      .then(shots => {
        if (gen !== genRef.current) return;
        setBranchShots(shots.map(s => (s.startsWith('data:') ? s : null)));
      })
      .catch(e => {
        if (gen !== genRef.current) return;
        setBranchError(String(e));
        setBranchShots(detectedRoutes.map(() => null));
      })
      .finally(() => { if (gen === genRef.current) setBranchLoading(false); });

    await Promise.allSettled([mainPromise, branchPromise]);
  }

  const isOutOfDate = branch.commitsBehind > 0;
  const multiRoute = routes.length > 1;

  // Show auth button when loading is done but all shots are null (auth-gated redirects)
  const loadingDone = !mainLoading && !branchLoading;
  const screenshotsMatch =
    loadingDone && !mainError && !branchError &&
    mainShots.length > 0 && branchShots.length > 0 &&
    mainShots.every((s, i) => s != null && s === branchShots[i]);
  const showAuthButton =
    loadingDone && !mainError && !branchError &&
    mainShots.length > 0 && mainShots.every(s => s === null) &&
    branchShots.length > 0 && branchShots.every(s => s === null);

  async function handleAuthSetup() {
    setAuthSetupLoading(true);
    try {
      await invoke('open_preview_browser', { repoPath, branch: branch.name });
    } catch (e) {
      console.error('Auth setup failed:', e);
    }
    setAuthSetupLoading(false);
    generatePreviews();
  }

  const renderSummary = () => {
    if (summaryLoading) {
      return (
        <div className="animate-pulse space-y-3 pt-1">
          <div className="h-3.5 bg-muted rounded w-1/2" />
          <div className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-5/6" />
            <div className="h-3 bg-muted rounded w-4/6" />
          </div>
          <div className="h-3.5 bg-muted rounded w-2/5 mt-4" />
          <div className="space-y-1.5">
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-3/4" />
          </div>
        </div>
      );
    }
    if (summary && summary.length > 0) {
      return (
        <div>
          {summary.map((sec, si) => (
            <div key={si}>
              {si > 0 && <div className="border-t border-border/50 my-4" />}
              <p className="text-sm font-semibold text-foreground mb-2">{sec.section}</p>
              <div className="space-y-1.5">
                {sec.changes.map((change, ci) => (
                  <div key={ci} className="flex items-start gap-1.5">
                    <span className={`text-xs font-semibold shrink-0 leading-snug mt-0.5 ${change.type === 'add' ? 'text-green-500 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
                      {change.type === 'add' ? '+' : '−'}
                    </span>
                    <span className={`text-sm leading-snug ${change.type === 'add' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>
                      {change.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    const msg =
      summaryState === 'no-diff'    ? `No unique commits ahead of ${defaultBranch}` :
      summaryState === 'no-key'     ? 'Set ANTHROPIC_API_KEY for AI change summaries' :
      summaryState === 'git-error'  ? 'Could not compute branch diff' :
      summaryState === 'api-error'  ? `Anthropic API error${apiErrorDetail ? `: ${apiErrorDetail}` : ' — check key or quota'}` :
      summaryState === 'parse-error'? 'Summary response could not be parsed' :
                                      'Could not load change summary';
    return <p className="text-xs text-muted-foreground italic">{msg}</p>;
  };

  const renderCommits = () => {
    if (commitsLoading) {
      return (
        <div className="animate-pulse space-y-0">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="py-3 border-b border-border/50 last:border-0">
              <div className="flex justify-between mb-1.5">
                <div className="h-3 bg-muted rounded w-14" />
                <div className="h-3 bg-muted rounded w-10" />
              </div>
              <div className="h-3 bg-muted rounded w-full mb-1" />
              <div className="h-3 bg-muted rounded w-3/5" />
              <div className="h-3 bg-muted rounded w-16 mt-1.5" />
            </div>
          ))}
        </div>
      );
    }
    if (commits.length > 0) {
      return (
        <div className="space-y-0">
          {commits.map((c, i) => (
            <div key={c.sha}>
              <div className="py-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-muted-foreground">{c.sha.slice(0, 7)}</span>
                  <span className="text-xs text-muted-foreground">{timeAgo(c.date)}</span>
                </div>
                <p className="text-sm text-foreground leading-snug">{c.message}</p>
                <p className="text-xs text-muted-foreground mt-1">@{c.author}</p>
              </div>
              {i < commits.length - 1 && <div className="border-t border-border/50" />}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="py-3">
        <p className="font-mono text-xs text-muted-foreground">{branch.headSha?.slice(0, 7) || '---'}</p>
        <p className="text-xs text-muted-foreground mt-1">@{branch.lastCommitAuthor}</p>
        <p className="text-xs text-muted-foreground">{timeAgo(branch.lastCommitDate)}</p>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 flex-shrink-0 relative">
        <button
          onClick={onBack}
          className="text-muted-foreground hover:text-foreground transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
          <h1 className="text-base font-medium text-foreground">
            {branch.name}
          </h1>
        </div>
        <div className="flex items-center gap-4">
          {isOutOfDate && (
            <div className="relative" data-ood-tooltip>
              <button
                onClick={() => setShowOutOfDateTooltip(o => !o)}
                className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1 transition-colors ${
                  showOutOfDateTooltip
                    ? 'text-destructive border-destructive/40 bg-destructive/10'
                    : 'text-destructive border-destructive/20 bg-destructive/5 hover:bg-destructive/10'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                {branch.commitsBehind} behind {defaultBranch}
              </button>
              {showOutOfDateTooltip && (
                <div className="absolute top-full right-0 mt-2 w-72 bg-card border border-border rounded-xl shadow-lg p-4 z-50 animate-error-panel-in">
                  <p className="text-xs font-medium text-foreground mb-1">Branch out of date</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    {branch.commitsBehind} new change{branch.commitsBehind !== 1 ? 's' : ''} have landed on{' '}
                    <span className="font-mono text-foreground">{defaultBranch}</span> since this branch was created
                    {branch.divergedFromDate && (
                      <> on {new Date(branch.divergedFromDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                    )}.
                    {' '}Updating keeps your work in sync and prevents conflicts later.
                  </p>
                  {branch.mergeable === false && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
                      This branch has conflicts with {defaultBranch} — you may need help resolving them before merging.
                    </p>
                  )}
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1.5">Run in your terminal</p>
                  <p className="text-xs text-foreground font-mono bg-muted rounded-lg px-3 py-2 select-all">
                    git rebase {defaultBranch}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    This replays your changes on top of the latest {defaultBranch}.
                  </p>
                </div>
              )}
            </div>
          )}
          {(showAuthButton || authSetupLoading) && (
            <button
              onClick={handleAuthSetup}
              disabled={authSetupLoading}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {authSetupLoading ? 'Log in and close Chrome to continue' : 'Authenticate Preview'}
            </button>
          )}
        </div>
      </header>

      {/* Main layout */}
      <div className="flex-1 px-8 py-6 min-h-0 flex gap-4">
        {/* Left: Changes panel */}
        <div className="w-72 flex-shrink-0 bg-card rounded-2xl border border-border flex flex-col overflow-hidden">
          <div className="px-5 pt-5 pb-4 flex-shrink-0">
            <h2 className="text-base font-semibold text-foreground mb-3">Changes</h2>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button
                onClick={() => setPanelView('summary')}
                className={`flex-1 text-xs py-1 rounded-md transition-colors ${panelView === 'summary' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Summary
              </button>
              <button
                onClick={() => setPanelView('commits')}
                className={`flex-1 text-xs py-1 rounded-md transition-colors ${panelView === 'commits' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                Commits {commits.length > 0 ? `(${commits.length})` : ''}
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-5">
            {panelView === 'summary' ? renderSummary() : renderCommits()}
          </div>
        </div>

        {/* Right: preview comparisons */}
        <div className="flex-1 min-w-0 min-h-0 flex gap-4">
          {multiRoute ? (
            <>
              {/* Main container — all routes stacked */}
              <div className="flex-1 min-w-0 rounded-2xl bg-card border border-border flex flex-col overflow-hidden">
                <div className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-border/50">
                  <h2 className="text-sm font-semibold text-foreground truncate">{defaultBranch}</h2>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {routes.map((route, i) => (
                    <div key={route}>
                      {i > 0 && <div className="border-t border-border/50" />}
                      <div className="px-5 pt-3 pb-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{route}</span>
                      </div>
                      {mainLoading ? (
                        <div className="animate-pulse px-5 pb-4 space-y-2">
                          <div className="h-32 bg-muted rounded-lg w-full" />
                        </div>
                      ) : mainError ? (
                        <div className="px-5 pb-4">
                          <p className="text-xs text-destructive">{mainError}</p>
                        </div>
                      ) : mainShots[i] ? (
                        <img src={mainShots[i]!} alt={route} className="w-full" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
              {/* Branch container — all routes stacked */}
              <div className="flex-1 min-w-0 rounded-2xl bg-card border border-border flex flex-col overflow-hidden">
                <div className="px-5 pt-5 pb-3 flex-shrink-0 border-b border-border/50 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-foreground truncate">{branch.name}</h2>
                  {screenshotsMatch && (
                    <div className="shrink-0 bg-muted rounded-full px-2.5 py-1 flex items-center">
                      <span className="text-[11px] text-muted-foreground leading-none">No visual changes</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {routes.map((route, i) => (
                    <div key={route}>
                      {i > 0 && <div className="border-t border-border/50" />}
                      <div className="px-5 pt-3 pb-1">
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{route}</span>
                      </div>
                      {branchLoading ? (
                        <div className="animate-pulse px-5 pb-4 space-y-2">
                          <div className="h-32 bg-muted rounded-lg w-full" />
                        </div>
                      ) : branchError ? (
                        branchError.includes('not a valid object name') || branchError.includes('git archive failed') ? (
                          <div className="px-5 pb-4 flex items-center">
                            <div className="space-y-1">
                              <p className="text-sm font-medium text-foreground">Preview unavailable</p>
                              <p className="text-xs text-muted-foreground">This branch was deleted after merging and can no longer be checked out.</p>
                            </div>
                          </div>
                        ) : (
                          <div className="px-5 pb-4">
                            <p className="text-xs text-destructive">{branchError}</p>
                          </div>
                        )
                      ) : branchShots[i] ? (
                        <img src={branchShots[i]!} alt={route} className="w-full" />
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <PreviewPanel
                title={defaultBranch}
                src={mainShots[0] ?? null}
                loading={mainLoading}
                error={mainError}
              />
              <PreviewPanel
                title={branch.name}
                src={branchShots[0] ?? null}
                loading={branchLoading}
                error={branchError}
                noVisualChanges={screenshotsMatch}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
