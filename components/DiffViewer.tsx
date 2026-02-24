'use client';

import { useState, useEffect } from 'react';
import { DiffResult, Commit, ComponentGroup } from '@/types';

type ViewMode = 'commit' | 'component';

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function DiffViewer({
  owner,
  repo,
  branch,
  commits,
  componentGroups,
  token,
}: {
  owner: string;
  repo: string;
  branch: string;
  commits: Commit[];
  componentGroups: ComponentGroup[];
  token?: string;
}) {
  const [viewMode, setViewMode] = useState<ViewMode>('commit');
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/diff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ owner, repo, branch, token }),
        });
        const data: DiffResult = await res.json();
        setDiffResult(data);
        if (!data.success) {
          setError(data.errorMessage ?? 'Diff failed');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Request failed');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [owner, repo, branch]);

  return (
    <div className="flex gap-4 h-full min-h-0">
      {/* ── Left: Changes panel ── */}
      <div className="w-72 flex-shrink-0 bg-white rounded-2xl p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-stone-900">Changes</h2>
          <button
            onClick={() => setViewMode(viewMode === 'commit' ? 'component' : 'commit')}
            className="text-xs text-stone-500 hover:text-stone-800 transition-colors"
          >
            View by: {viewMode === 'commit' ? 'Commit' : 'Component'}
          </button>
        </div>

        {viewMode === 'commit' ? (
          <div className="space-y-0">
            {commits.map((c, i) => (
              <div key={c.sha}>
                <div className="py-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-stone-400">{c.sha}</span>
                    <span className="text-xs text-stone-400">{fmtDate(c.date)}</span>
                  </div>
                  <p className="text-sm text-stone-500 leading-snug">{c.message}</p>
                  <p className="text-xs text-stone-400 mt-1">@{c.author}</p>
                </div>
                {i < commits.length - 1 && <div className="border-t border-stone-100" />}
              </div>
            ))}
            {commits.length === 0 && (
              <p className="text-xs text-stone-400 italic">No commits found</p>
            )}
          </div>
        ) : (
          <div className="space-y-0">
            {componentGroups.map((g, i) => (
              <div key={g.folder}>
                <div className="py-3">
                  <p className="text-sm font-medium text-stone-800 mb-1">{g.label}</p>
                  {g.additions > 0 && (
                    <p className="text-xs text-emerald-600">+ {g.additions} additions</p>
                  )}
                  {g.deletions > 0 && (
                    <p className="text-xs text-red-500">- {g.deletions} deletions</p>
                  )}
                </div>
                {i < componentGroups.length - 1 && <div className="border-t border-stone-100" />}
              </div>
            ))}
            {componentGroups.length === 0 && (
              <p className="text-xs text-stone-400 italic">No changed files found</p>
            )}
          </div>
        )}
      </div>

      {/* ── Center: Main screenshot ── */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-600 mb-3">Main</p>
        <div className="rounded-2xl overflow-hidden bg-white shadow-sm border border-stone-100 h-[calc(100%-2rem)]">
          {loading ? (
            <ScreenshotSkeleton label="Building main…" />
          ) : diffResult?.mainScreenshot ? (
            <img
              src={`data:image/png;base64,${diffResult.mainScreenshot}`}
              alt="Main branch screenshot"
              className="w-full object-cover object-top"
            />
          ) : (
            <ScreenshotError log={diffResult?.buildLog} />
          )}
        </div>
      </div>

      {/* ── Right: Branch screenshot ── */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-stone-600 mb-3">{branch}</p>
        <div className="rounded-2xl overflow-hidden bg-white shadow-sm border border-stone-100 h-[calc(100%-2rem)]">
          {loading ? (
            <ScreenshotSkeleton label={`Building ${branch}…`} />
          ) : diffResult?.branchScreenshot ? (
            <img
              src={`data:image/png;base64,${diffResult.branchScreenshot}`}
              alt={`${branch} screenshot`}
              className="w-full object-cover object-top"
            />
          ) : (
            <ScreenshotError log={diffResult?.buildLog} />
          )}
        </div>
      </div>
    </div>
  );
}

function ScreenshotSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-64 text-stone-400 gap-3 p-8">
      <div className="w-6 h-6 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
      <p className="text-xs">{label}</p>
      <p className="text-xs text-stone-300 text-center">
        First build may take up to 90 seconds
      </p>
    </div>
  );
}

function ScreenshotError({ log }: { log?: string | null }) {
  const [showLog, setShowLog] = useState(false);
  return (
    <div className="flex flex-col items-start p-6 h-full min-h-64 gap-3">
      <p className="text-sm text-stone-500">Visual preview unavailable</p>
      {log && (
        <>
          <button
            onClick={() => setShowLog(!showLog)}
            className="text-xs text-stone-400 underline"
          >
            {showLog ? 'Hide' : 'Show'} build log
          </button>
          {showLog && (
            <pre className="text-xs text-stone-400 bg-stone-50 p-3 rounded overflow-auto max-h-48 w-full">
              {log}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
