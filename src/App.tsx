import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import BranchMap from '../components/BranchMap';
import FolderPickerModal from './FolderPickerModal';
import type { Branch, MergeNode } from '../types';

function App() {
  const [repoPath, setRepoPath] = useState<string | null>(null);
  const [repoName, setRepoName] = useState<string>('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [mergeNodes, setMergeNodes] = useState<MergeNode[]>([]);
  const [defaultBranch, setDefaultBranch] = useState<string>('main');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    } catch (e) {
      console.error('Failed to load repo:', e);
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
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

  return (
    <div className="h-screen bg-stone-900 text-stone-100 flex flex-col">
      {!repoPath ? (
        <RepoSelector onSelect={loadRepo} loading={loading} error={error} />
      ) : (
        <>
          <header className="px-4 py-2 border-b border-stone-700 flex items-center gap-4">
            <button
              onClick={() => setRepoPath(null)}
              className="text-stone-400 hover:text-white"
            >
              ← Back
            </button>
            <h1 className="font-medium">{repoName}</h1>
          </header>
          <div className="flex-1 overflow-hidden">
            <BranchMap
              branches={branches}
              mergeNodes={mergeNodes}
              defaultBranch={defaultBranch}
              onLoadMore={loadMoreNodes}
            />
          </div>
        </>
      )}
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

  function handlePickerSelect(selectedPath: string) {
    setShowPicker(false);
    onSelect(selectedPath);
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="bg-stone-800 p-8 rounded-lg w-96">
        <h1 className="text-xl font-bold mb-4">Git Visualizer</h1>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            placeholder="/path/to/repo"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="flex-1 px-3 py-2 bg-stone-700 rounded text-stone-100 placeholder-stone-500"
            onKeyDown={(e) => e.key === 'Enter' && path && onSelect(path)}
          />
          <button
            onClick={() => setShowPicker(true)}
            className="px-3 py-2 bg-stone-700 hover:bg-stone-600 rounded text-stone-300 hover:text-white"
            title="Browse folders"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
          </button>
        </div>
        {error && (
          <div className="mb-4 p-2 bg-red-900/50 border border-red-700 rounded text-red-200 text-sm">
            {error}
          </div>
        )}
        <button
          onClick={() => path && onSelect(path)}
          disabled={!path || loading}
          className="w-full py-2 bg-blue-600 rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Loading...' : 'Open Repository'}
        </button>
      </div>

      {showPicker && (
        <FolderPickerModal
          onSelect={handlePickerSelect}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

export default App;
