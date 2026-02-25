'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronDown, Check, X } from 'lucide-react';
import { PageHeader } from './PageHeader';
import { Branch, MergeNode, MergedPR } from '@/types';
import { useState, useRef, useEffect } from 'react';
import BranchMap from './BranchMap';
import BranchGroupView from './BranchGroupView';

export type ViewMode = 'time' | 'status' | 'creator';

const VIEW_LABELS: Record<ViewMode, string> = {
  time: 'By time',
  status: 'By status',
  creator: 'By creator',
};

function fmtRelativeDate(dateStr: string): string {
  const diffDays = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

interface Props {
  branches: Branch[];
  mergeNodes: MergeNode[];
  mergedPRs: MergedPR[];
  owner: string;
  repo: string;
  defaultBranch: string;
  initialHasMore: boolean;
  hasMoreBranchPages?: boolean;
  fetchError: string | null;
}

export default function BranchMapView({
  branches,
  mergeNodes,
  mergedPRs,
  owner,
  repo,
  defaultBranch,
  initialHasMore,
  hasMoreBranchPages = false,
  fetchError,
}: Props) {
  const [view, setView] = useState<ViewMode>('time');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [errorPanelOpen, setErrorPanelOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const errorPanelRef = useRef<HTMLDivElement>(null);
  const [allBranches, setAllBranches] = useState<Branch[]>(branches);
  const nextPageRef = useRef(2);
  const loadingRef = useRef(false);

  // Progressively load additional branch pages in the background
  useEffect(() => {
    if (!hasMoreBranchPages) return;
    if (loadingRef.current) return;
    loadingRef.current = true;

    (async () => {
      while (true) {
        const page = nextPageRef.current;
        try {
          const res = await fetch(
            `/api/branches?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&page=${page}&defaultBranch=${encodeURIComponent(defaultBranch)}`
          );
          if (!res.ok) break;
          const data = await res.json();
          const newBranches: Branch[] = data.branches ?? [];
          if (newBranches.length > 0) {
            setAllBranches(prev => {
              const namesSeen = new Set(prev.map(b => b.name));
              const deduped = newBranches.filter(b => !namesSeen.has(b.name));
              const merged = [...prev, ...deduped];
              merged.sort((a, b) =>
                new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime()
              );
              return merged;
            });
          }
          nextPageRef.current++;
          if (!data.hasMore) break;
        } catch {
          break;
        }
      }
      loadingRef.current = false;
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!errorPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (!errorPanelRef.current?.contains(e.target as Node)) setErrorPanelOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [errorPanelOpen]);

  const errorBranches = allBranches.filter(
    (b) => b.status === 'conflict-risk' || b.status === 'stale'
  );
  const conflictBranches = errorBranches.filter(b => b.status === 'conflict-risk')
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());
  const staleBranches = errorBranches.filter(b => b.status === 'stale')
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime());

  return (
    <div className="relative h-screen flex flex-col bg-background">
      <PageHeader
        left={
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        }
        center={
          <h1 className="text-sm font-medium text-foreground">{owner}/{repo}</h1>
        }
        right={
          <>
            {errorBranches.length > 0 && (
              <button
                onClick={() => setErrorPanelOpen((o) => !o)}
                className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1 transition-colors ${
                  errorPanelOpen
                    ? 'text-destructive border-destructive/40 bg-destructive/10'
                    : 'text-destructive border-destructive/20 bg-destructive/5 hover:bg-destructive/10'
                }`}
              >
                ⚠ {errorBranches.length} branch error{errorBranches.length !== 1 ? 's' : ''}
              </button>
            )}

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
                  {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
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
          </>
        }
      />

      {fetchError ? (
        <div className="flex items-center justify-center pt-32">
          <div className="text-center bg-muted/30 shadow-inner rounded-xl px-10 py-8">
            <p className="text-sm font-medium text-foreground mb-1">Could not load repository</p>
            <p className="text-sm text-muted-foreground">{fetchError}</p>
          </div>
        </div>
      ) : view === 'time' ? (
        <div className="flex-1 min-h-0 px-8 pt-4 pb-12">
          <BranchMap
            branches={allBranches}
            mergeNodes={mergeNodes}
            mergedPRs={mergedPRs}
            owner={owner}
            repo={repo}
            defaultBranch={defaultBranch}
            initialHasMore={initialHasMore}
            view={view}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 px-8 pt-6 pb-16 overflow-y-auto">
          <BranchGroupView
            view={view}
            branches={allBranches}
            owner={owner}
            repo={repo}
            defaultBranch={defaultBranch}
          />
        </div>
      )}

      {/* ── Error panel ── */}
      <div
        ref={errorPanelRef}
        className={`absolute right-4 top-16 bottom-4 w-72 flex flex-col bg-card/90 backdrop-blur-sm rounded-2xl border border-border shadow-lg z-40 transition-all duration-300 ease-in-out ${
          errorPanelOpen ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <span className="text-sm font-medium text-foreground">Branch errors</span>
          <button
            onClick={() => setErrorPanelOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {conflictBranches.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-4 pt-2 pb-1">
                Conflict risk
              </p>
              {conflictBranches.map(b => (
                <a
                  key={b.name}
                  href={`/repo/${owner}/${repo}/diff/${encodeURIComponent(b.name)}`}
                  className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors cursor-pointer"
                >
                  <span className="mt-0.5 w-2 h-2 rounded-full bg-destructive shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.lastCommitAuthor ? `${b.lastCommitAuthor} · ` : ''}{fmtRelativeDate(b.lastCommitDate)}
                    </p>
                  </div>
                </a>
              ))}
            </>
          )}

          {staleBranches.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-4 pt-3 pb-1">
                Stale
              </p>
              {staleBranches.map(b => (
                <a
                  key={b.name}
                  href={`/repo/${owner}/${repo}/diff/${encodeURIComponent(b.name)}`}
                  className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors cursor-pointer"
                >
                  <span className="mt-0.5 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.lastCommitAuthor ? `${b.lastCommitAuthor} · ` : ''}{fmtRelativeDate(b.lastCommitDate)}
                    </p>
                  </div>
                </a>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
