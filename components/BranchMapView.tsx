'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronDown, Check } from 'lucide-react';
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
  const dropdownRef = useRef<HTMLDivElement>(null);
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
          <h1 className="text-sm font-medium text-foreground" style={{ fontFamily: 'var(--font-space-grotesk), system-ui, sans-serif' }}>{owner}/{repo}</h1>
        }
        right={
          <>
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
            conflictBranches={conflictBranches}
            staleBranches={staleBranches}
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

    </div>
  );
}
