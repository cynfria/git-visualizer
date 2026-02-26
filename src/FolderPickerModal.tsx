import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  isRepo: boolean;
}

interface FolderPickerModalProps {
  onSelect: (path: string) => void;
  onClose: () => void;
}

export default function FolderPickerModal({ onSelect, onClose }: FolderPickerModalProps) {
  const [query, setQuery] = useState('');
  const [currentDir, setCurrentDir] = useState('');
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [searchResults, setSearchResults] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSearching = query.length >= 2;

  // Initialize on mount
  useEffect(() => {
    invoke<string>('get_home_dir').then((dir) => {
      setHomeDir(dir);
      setCurrentDir(dir);
    });
  }, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load directory when currentDir changes (only when not searching)
  useEffect(() => {
    if (currentDir && !isSearching) {
      loadDirectory(currentDir);
    }
  }, [currentDir, isSearching]);

  // Debounced search when query changes
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (!query || query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const depth = currentDir === homeDir ? 4 : 3;
        const results = await invoke<DirEntry[]>('search_directories', {
          path: currentDir,
          query,
          maxDepth: depth,
          limit: 20,
        });
        setSearchResults(results);
        setSelectedIndex(0);
      } catch (e) {
        console.error('Search failed:', e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 150);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query, currentDir, homeDir]);

  // Reset selection when results change
  useEffect(() => {
    if (!isSearching) {
      setSelectedIndex(0);
    }
  }, [entries, isSearching]);

  async function loadDirectory(path: string) {
    setLoading(true);
    setError(null);

    try {
      const allEntries = await invoke<DirEntry[]>('list_directory', { path });
      // Only show directories
      setEntries(allEntries.filter((e) => e.isDir));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }

  // Combined list for selection
  const allItems = isSearching ? searchResults : entries;

  const navigateTo = useCallback((path: string) => {
    setQuery('');
    setCurrentDir(path);
  }, []);

  const navigateUp = useCallback(() => {
    if (currentDir === '/') return;
    const parent = currentDir.split('/').slice(0, -1).join('/') || '/';
    navigateTo(parent);
  }, [currentDir, navigateTo]);

  const navigateHome = useCallback(() => {
    if (homeDir) {
      navigateTo(homeDir);
    }
  }, [homeDir, navigateTo]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      if (query) {
        setQuery('');
        e.preventDefault();
      } else {
        onClose();
        e.preventDefault();
      }
    } else if (e.key === 'Enter') {
      const item = allItems[selectedIndex];
      if (item) {
        if (item.isRepo) {
          onSelect(item.path);
        } else {
          navigateTo(item.path);
        }
      } else if (!isSearching && entries.length === 0) {
        onSelect(currentDir);
      }
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'ArrowLeft' && !isSearching) {
      e.preventDefault();
      navigateUp();
    } else if (e.key === 'ArrowRight' || e.key === 'Tab') {
      const item = allItems[selectedIndex];
      if (item) {
        e.preventDefault();
        navigateTo(item.path);
      } else if (e.key === 'Tab') {
        e.preventDefault();
      }
    } else if (e.key === 'Backspace' && !query && !isSearching) {
      e.preventDefault();
      navigateUp();
    }
  }

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function formatPath(path: string): string {
    if (homeDir && path.startsWith(homeDir)) {
      return '~' + path.slice(homeDir.length);
    }
    return path;
  }

  function getBreadcrumbs(path: string): { name: string; path: string }[] {
    const parts = path.split('/').filter(Boolean);
    const crumbs: { name: string; path: string }[] = [];

    let currentPath = '';
    for (const part of parts) {
      currentPath += '/' + part;
      crumbs.push({ name: part, path: currentPath });
    }

    return crumbs;
  }

  function highlightMatch(text: string, q: string): React.ReactNode {
    if (!q) return text;

    const textLower = text.toLowerCase();
    const queryLower = q.toLowerCase();
    const idx = textLower.indexOf(queryLower);

    if (idx === -1) return text;

    const before = text.slice(0, idx);
    const match = text.slice(idx, idx + q.length);
    const after = text.slice(idx + q.length);

    return (
      <>
        {before}
        <mark className="bg-blue-500/30 text-blue-300 rounded px-0.5">{match}</mark>
        {after}
      </>
    );
  }

  const breadcrumbs = getBreadcrumbs(currentDir);

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[12vh] z-50"
      onClick={handleBackdropClick}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
    >
      <div className="bg-stone-800 rounded-xl shadow-2xl w-[520px] max-w-[90vw] max-h-[65vh] flex flex-col overflow-hidden">
        {/* Header with breadcrumbs */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-700">
          <div className="flex-1 flex items-center gap-0.5 overflow-x-auto scrollbar-hide">
            <button
              className="flex items-center p-1.5 hover:bg-stone-700 rounded text-stone-400 hover:text-white"
              onClick={navigateHome}
              title="Home (~)"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            </button>
            {breadcrumbs.map((crumb, i) => (
              <span key={crumb.path} className="flex items-center">
                <svg className="w-3 h-3 text-stone-500 mx-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <button
                  className={`px-1.5 py-1 hover:bg-stone-700 rounded text-sm whitespace-nowrap ${
                    i === breadcrumbs.length - 1 ? 'text-white font-medium' : 'text-stone-400 hover:text-white'
                  }`}
                  onClick={() => navigateTo(crumb.path)}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>
          <button
            className="p-1.5 hover:bg-stone-700 rounded text-stone-400 hover:text-white"
            onClick={onClose}
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-stone-700">
          <div className="flex items-center justify-center text-stone-400">
            {searching ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            )}
          </div>
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-stone-500"
            placeholder="Search folders..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="p-1 hover:bg-stone-700 rounded text-stone-400 hover:text-white"
              onClick={() => setQuery('')}
              title="Clear"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto py-1">
          {loading && !isSearching ? (
            <div className="py-6 text-center text-stone-400 text-sm">Loading...</div>
          ) : error && !isSearching ? (
            <div className="py-6 text-center text-red-400 text-sm">{error}</div>
          ) : (
            <>
              {isSearching ? (
                searchResults.length > 0 ? (
                  <>
                    <div className="flex items-center gap-1.5 px-4 py-2 text-xs text-stone-500 uppercase tracking-wider">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                      <span>Results</span>
                    </div>
                    {searchResults.map((entry, i) => (
                      <button
                        key={entry.path}
                        className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-stone-700/50 ${
                          i === selectedIndex ? 'bg-stone-700/50' : ''
                        }`}
                        onClick={() => onSelect(entry.path)}
                        onMouseEnter={() => setSelectedIndex(i)}
                      >
                        <svg className={`w-4 h-4 flex-shrink-0 ${entry.isRepo ? 'text-blue-400' : 'text-stone-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {entry.isRepo ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                          )}
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="truncate">{highlightMatch(entry.name, query)}</div>
                          <div className="text-xs text-stone-500 font-mono truncate">
                            {highlightMatch(formatPath(entry.path), query)}
                          </div>
                        </div>
                        <svg className="w-3.5 h-3.5 text-stone-500 opacity-0 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}
                  </>
                ) : !searching ? (
                  <div className="py-6 text-center text-stone-400 text-sm">No matching folders</div>
                ) : null
              ) : entries.length > 0 ? (
                entries.map((entry, i) => (
                  <button
                    key={entry.path}
                    className={`w-full flex items-center gap-2.5 px-4 py-2 text-left text-sm hover:bg-stone-700/50 ${
                      i === selectedIndex ? 'bg-stone-700/50' : ''
                    }`}
                    onClick={() => (entry.isRepo ? onSelect(entry.path) : navigateTo(entry.path))}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <svg className={`w-4 h-4 flex-shrink-0 ${entry.isRepo ? 'text-blue-400' : 'text-stone-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {entry.isRepo ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      )}
                    </svg>
                    <span className="flex-1 truncate">{entry.name}</span>
                    <svg className="w-3.5 h-3.5 text-stone-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                ))
              ) : !loading ? (
                <div className="py-6 text-center text-stone-400 text-sm">Empty directory</div>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-stone-700 bg-stone-800/50">
          <span className="text-xs text-stone-500">
            <kbd className="px-1.5 py-0.5 bg-stone-700 rounded text-[10px] font-mono mx-0.5">↑↓</kbd> navigate
            <kbd className="px-1.5 py-0.5 bg-stone-700 rounded text-[10px] font-mono mx-0.5 ml-2">Enter</kbd> open
            <kbd className="px-1.5 py-0.5 bg-stone-700 rounded text-[10px] font-mono mx-0.5 ml-2">Tab</kbd> drill in
            <kbd className="px-1.5 py-0.5 bg-stone-700 rounded text-[10px] font-mono mx-0.5 ml-2">←</kbd> back
          </span>
          <button
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium truncate max-w-[200px]"
            onClick={() => onSelect(currentDir)}
          >
            Open {formatPath(currentDir)}
          </button>
        </div>
      </div>
    </div>
  );
}
