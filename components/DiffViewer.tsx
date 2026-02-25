import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Branch, Commit } from '../types';

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface DiffViewerProps {
  repoPath: string;
  branch: Branch;
  defaultBranch: string;
  onBack: () => void;
}

export default function DiffViewer({
  repoPath,
  branch,
  defaultBranch,
  onBack,
}: DiffViewerProps) {
  const [commits, setCommits] = useState<Commit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCommits() {
      setLoading(true);
      try {
        const result = await invoke<Commit[]>('get_branch_commits', {
          repoPath,
          branch: branch.name,
          baseBranch: defaultBranch,
        });
        setCommits(result);
      } catch (e) {
        // Command might not exist yet - use empty array
        console.log('get_branch_commits not available:', e);
        setCommits([]);
      }
      setLoading(false);
    }
    loadCommits();
  }, [repoPath, branch.name, defaultBranch]);

  const isOutOfDate = branch.commitsBehind > 0;

  return (
    <div className="h-full flex flex-col bg-[#1c1917]">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 flex-shrink-0 relative border-b border-stone-800">
        <button
          onClick={onBack}
          className="text-stone-500 hover:text-stone-200 transition-colors text-sm"
        >
          ← Back
        </button>
        <h1 className="text-base font-medium text-stone-100 absolute left-1/2 -translate-x-1/2">
          {branch.name}
        </h1>
        <div className="flex items-center gap-3">
          {isOutOfDate && (
            <span className="flex items-center gap-1.5 text-sm text-red-400">
              ⚠ Branch out of date ({branch.commitsBehind} behind)
            </span>
          )}
        </div>
      </header>

      {/* Main 3-column layout */}
      <div className="flex-1 px-8 py-6 min-h-0 flex gap-4">
        {/* Left: Changes panel */}
        <div className="w-72 flex-shrink-0 bg-stone-800 rounded-2xl p-5 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-stone-100">Changes</h2>
            <span className="text-xs text-stone-500">
              +{branch.commitsAhead} commits
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 text-stone-500">
              <div className="w-4 h-4 border-2 border-stone-600 border-t-stone-400 rounded-full animate-spin" />
              <span className="text-sm">Loading commits...</span>
            </div>
          ) : commits.length > 0 ? (
            <div className="space-y-0">
              {commits.map((c, i) => (
                <div key={c.sha}>
                  <div className="py-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs text-stone-500">{c.sha.slice(0, 7)}</span>
                      <span className="text-xs text-stone-600">{fmtDate(c.date)}</span>
                    </div>
                    <p className="text-sm text-stone-400 leading-snug">{c.message}</p>
                    <p className="text-xs text-stone-600 mt-1">@{c.author}</p>
                  </div>
                  {i < commits.length - 1 && <div className="border-t border-stone-700" />}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {/* Show branch info when commits aren't available */}
              <div className="py-3 border-b border-stone-700">
                <p className="text-sm text-stone-400">Latest commit</p>
                <p className="font-mono text-xs text-stone-500 mt-1">{branch.headSha?.slice(0, 7) || '---'}</p>
                <p className="text-xs text-stone-600 mt-1">@{branch.lastCommitAuthor}</p>
                <p className="text-xs text-stone-600">{fmtDate(branch.lastCommitDate)}</p>
              </div>
              <p className="text-xs text-stone-600 italic">
                Detailed commit list requires additional backend setup
              </p>
            </div>
          )}
        </div>

        {/* Center: Main branch preview */}
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-sm font-medium text-stone-500 mb-3">{defaultBranch}</p>
          <div className="flex-1 rounded-2xl overflow-hidden bg-stone-800 border border-stone-700 flex items-center justify-center">
            <div className="text-center p-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-700 flex items-center justify-center">
                <svg className="w-8 h-8 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm text-stone-500">Visual preview</p>
              <p className="text-xs text-stone-600 mt-1">Coming soon</p>
            </div>
          </div>
        </div>

        {/* Right: Branch preview */}
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-sm font-medium text-stone-500 mb-3">{branch.name}</p>
          <div className="flex-1 rounded-2xl overflow-hidden bg-stone-800 border border-stone-700 flex items-center justify-center">
            <div className="text-center p-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-stone-700 flex items-center justify-center">
                <svg className="w-8 h-8 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-sm text-stone-500">Visual preview</p>
              <p className="text-xs text-stone-600 mt-1">Coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
