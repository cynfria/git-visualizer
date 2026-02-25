'use client';

import Link from 'next/link';
import { ArrowLeft, ChevronDown, Check } from 'lucide-react';
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
  fetchError,
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

  const errorBranches = branches.filter(
    (b) => b.status === 'conflict-risk' || b.status === 'stale'
  );

  return (
    <div className="h-screen flex flex-col bg-background">
      <header className="relative flex items-center justify-between px-8 py-4 border-b border-border/50">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-sm font-medium text-foreground absolute left-1/2 -translate-x-1/2">
          {owner}/{repo}
        </h1>
        <div className="flex items-center gap-2">
          {errorBranches.length > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-destructive border border-destructive/20 rounded-full px-3 py-1 bg-destructive/5">
              ⚠ {errorBranches.length} branch error{errorBranches.length !== 1 ? 's' : ''}
            </span>
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
        </div>
      </header>

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
            branches={branches}
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
            branches={branches}
            owner={owner}
            repo={repo}
            defaultBranch={defaultBranch}
          />
        </div>
      )}
    </div>
  );
}
