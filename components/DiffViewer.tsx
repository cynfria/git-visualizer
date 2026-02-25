'use client';

import { useState } from 'react';
import { Commit, ComponentGroup } from '@/types';

type PanelMode = 'component' | 'commit';

function timeAgo(dateStr: string) {
  const s = (Date.now() - new Date(dateStr).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function DiffViewer({
  branch,
  commits,
  componentGroups,
}: {
  owner: string;
  repo: string;
  branch: string;
  commits: Commit[];
  componentGroups: ComponentGroup[];
}) {
  const [mode, setMode] = useState<PanelMode>('component');

  return (
    <div className="flex gap-4 h-full min-h-0">

      {/* ── Left: Changes panel ────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 bg-card rounded-2xl border border-border/50 flex flex-col min-h-0">
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 shrink-0">
          <h2 className="text-sm font-semibold text-foreground">Changes</h2>
          <button
            onClick={() => setMode(mode === 'component' ? 'commit' : 'component')}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            View by: {mode === 'component' ? 'Component' : 'Commit'}
          </button>
        </div>

        {/* Panel body */}
        <div className="flex-1 overflow-y-auto px-5 pb-5 min-h-0">
          {mode === 'component' ? (
            componentGroups.length > 0 ? (
              componentGroups.map((g, i) => (
                <div key={g.folder}>
                  <div className="py-3">
                    <p className="text-sm font-medium text-foreground mb-1.5">{g.label}</p>
                    {g.files
                      .filter((f) => f.status !== 'removed')
                      .slice(0, 6)
                      .map((f) => (
                        <p key={f.filename} className="text-xs text-green-600 dark:text-green-400 leading-relaxed">
                          + {f.filename.split('/').pop()}
                        </p>
                      ))}
                    {g.files
                      .filter((f) => f.status === 'removed')
                      .slice(0, 3)
                      .map((f) => (
                        <p key={f.filename} className="text-xs text-destructive leading-relaxed">
                          − {f.filename.split('/').pop()}
                        </p>
                      ))}
                  </div>
                  {i < componentGroups.length - 1 && (
                    <div className="border-t border-border/50" />
                  )}
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-muted-foreground">No changed files</p>
              </div>
            )
          ) : (
            commits.length > 0 ? (
              commits.map((c, i) => (
                <div key={c.sha}>
                  <div className="py-3">
                    <div className="flex items-center gap-2 mb-1">
                      {c.authorAvatar ? (
                        <img src={c.authorAvatar} alt={c.author} className="w-4 h-4 rounded-full shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-muted shrink-0" />
                      )}
                      <span className="text-xs text-muted-foreground truncate">{c.author}</span>
                      <span className="text-xs text-muted-foreground ml-auto shrink-0">{timeAgo(c.date)}</span>
                    </div>
                    <p className="text-xs text-foreground leading-snug">{c.message}</p>
                    <p className="text-[10px] text-muted-foreground font-mono mt-1">{c.sha}</p>
                  </div>
                  {i < commits.length - 1 && (
                    <div className="border-t border-border/50" />
                  )}
                </div>
              ))
            ) : (
              <div className="h-full flex items-center justify-center">
                <p className="text-xs text-muted-foreground">No commits found</p>
              </div>
            )
          )}
        </div>
      </div>

      {/* ── Center: Main ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <p className="text-sm font-medium text-muted-foreground mb-3 shrink-0">Main</p>
        <div className="flex-1 rounded-2xl border border-border/50 bg-muted/40 min-h-0" />
      </div>

      {/* ── Right: Branch ──────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        <p className="text-sm font-medium text-muted-foreground mb-3 shrink-0">Branch</p>
        <div className="flex-1 rounded-2xl border border-border/50 bg-muted/40 min-h-0" />
      </div>

    </div>
  );
}
