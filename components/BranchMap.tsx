'use client';

import { useRouter } from 'next/navigation';
import { Branch, MergeNode, MergedPR } from '@/types';
import { useState, useRef, useEffect } from 'react';

// ── Layout constants ──────────────────────────────────────────────────────────
const MAIN_Y = 420;
const LEFT_PAD = 60;
const RIGHT_PAD = 160;
const MIN_BRANCH_SPACING_X = 120; // min horizontal gap between branches
const LANE_HEIGHT = 60;           // vertical gap between branch lanes
const NODE_SIZE = 8;
const CORNER_R = 20;
const MAX_ACTIVE = 50;            // show up to 50 active branches
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type TooltipData = { x: number; y: number; lines: string[] };
type PRCommitHover = { x: number; arcY: number; pr: MergedPR; commitIdx: number; total: number };

function fmtTooltipDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}
function fmtLabelDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: '2-digit',
    hour: 'numeric', minute: '2-digit',
  });
}

export default function BranchMap({
  branches,
  mergeNodes,
  mergedPRs,
  owner,
  repo,
  defaultBranch,
  initialHasMore,
}: {
  branches: Branch[];
  mergeNodes: MergeNode[];
  mergedPRs: MergedPR[];
  owner: string;
  repo: string;
  defaultBranch: string;
  initialHasMore: boolean;
}) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const [hoveredPR, setHoveredPR] = useState<number | null>(null);
  const [hoveredPRCommit, setHoveredPRCommit] = useState<PRCommitHover | null>(null);
  const [zoom, setZoom] = useState(1);
  const [prCommits, setPrCommits] = useState<Map<number, string[]>>(new Map());

  // Pagination state
  const [allNodes, setAllNodes] = useState<MergeNode[]>(mergeNodes);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomScrollAnchor = useRef<{ contentX: number; mouseX: number; oldZoom: number } | null>(null);
  // Refs so the async loop always reads current values without stale closure issues
  const pageRef = useRef(2);
  const hasMoreRef = useRef(initialHasMore);

  // Eagerly load all remaining history on mount so the scrollbar shows the full width immediately
  useEffect(() => {
    if (!hasMoreRef.current) return;
    async function loadAll() {
      while (hasMoreRef.current) {
        setLoadingMore(true);
        try {
          const scrollEl = scrollRef.current;
          const prevWidth = scrollEl?.scrollWidth ?? 0;
          const res = await fetch(
            `/api/commits?owner=${owner}&repo=${repo}&sha=${defaultBranch}&page=${pageRef.current}&per_page=100`
          );
          const data = await res.json();
          if (data.nodes?.length > 0) {
            setAllNodes(prev => {
              const existingShas = new Set(prev.map((n: MergeNode) => n.fullSha));
              const newNodes = data.nodes.filter((n: MergeNode) => !existingShas.has(n.fullSha));
              return [...newNodes, ...prev];
            });
            // After render, restore scroll so the visible area doesn't jump
            requestAnimationFrame(() => {
              if (scrollEl) scrollEl.scrollLeft += scrollEl.scrollWidth - prevWidth;
            });
            pageRef.current++;
            hasMoreRef.current = data.hasMore;
          } else {
            hasMoreRef.current = false;
          }
        } catch {
          hasMoreRef.current = false;
        }
        setLoadingMore(false);
      }
      setHasMore(false);
    }
    loadAll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On initial mount, scroll to the right so most recent content is visible
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, []);

  // Ctrl+wheel → zoom the timeline
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const contentX = el.scrollLeft + mouseX;
      setZoom(prev => {
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round((prev + delta) * 100) / 100));
        zoomScrollAnchor.current = { contentX, mouseX, oldZoom: prev };
        return newZoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Preserve scroll anchor after zoom
  useEffect(() => {
    const anchor = zoomScrollAnchor.current;
    if (!anchor) return;
    zoomScrollAnchor.current = null;
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        const scaledX = LEFT_PAD + (anchor.contentX - LEFT_PAD) * (zoom / anchor.oldZoom);
        scrollRef.current.scrollLeft = scaledX - anchor.mouseX;
      }
    });
  }, [zoom]);

  // Fetch real commit counts for loaded PRs (the list API doesn't include this field)
  useEffect(() => {
    if (mergedPRs.length === 0) return;
    const numbers = mergedPRs.map((pr) => pr.number).join(',');
    fetch(`/api/pr-counts?owner=${owner}&repo=${repo}&numbers=${numbers}`)
      .then((r) => r.json())
      .then((data: Record<string, string[]>) => {
        setPrCommits(new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v])));
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Separate active vs merged branches ──────────────────────────────────────
  const activeBranches = branches
    .filter(b => b.name !== defaultBranch && b.commitsAhead > 0)
    .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime())
    .slice(0, MAX_ACTIVE);

  // Show all fetched merged PRs
  const displayedMergedPRs = mergedPRs;

  // ── Build a date → X mapping ─────────────────────────────────────────────
  // Sort merge nodes chronologically and space them evenly by index.
  // Pure time-based mapping compresses everything when commits are days apart,
  // so we enforce a minimum pixel gap between nodes and interpolate everything else.
  const NODE_SPACING = Math.max(MIN_BRANCH_SPACING_X, Math.round(160 * zoom));

  const sortedNodes = [...allNodes].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Merge nodes are the sole timeline anchors, evenly spaced at NODE_SPACING.
  // All date → X mapping interpolates between them, or clamps at the edges.
  const nodeXByFullSha = new Map<string, number>();
  sortedNodes.forEach((m, i) => {
    nodeXByFullSha.set(m.fullSha, LEFT_PAD + i * NODE_SPACING);
  });

  const mainEndX = LEFT_PAD + Math.max(sortedNodes.length - 1, 0) * NODE_SPACING;
  const svgWidth = mainEndX + RIGHT_PAD + 80;

  // Pre-compute time range of the merge nodes for extrapolation
  const firstNodeT = sortedNodes.length > 0 ? new Date(sortedNodes[0].date).getTime() : Date.now();
  const lastNodeT  = sortedNodes.length > 1 ? new Date(sortedNodes[sortedNodes.length - 1].date).getTime() : firstNodeT + 1;
  const nodeTimeSpan = Math.max(lastNodeT - firstNodeT, 1);
  const pxPerMs = (mainEndX - LEFT_PAD) / nodeTimeSpan;

  function timeToX(dateStr: string): number {
    const t = new Date(dateStr).getTime();
    if (sortedNodes.length === 0) return LEFT_PAD;

    // Interpolate between surrounding merge nodes
    for (let i = 0; i < sortedNodes.length - 1; i++) {
      const tA = new Date(sortedNodes[i].date).getTime();
      const tB = new Date(sortedNodes[i + 1].date).getTime();
      if (t >= tA && t <= tB) {
        const ratio = (t - tA) / (tB - tA);
        return LEFT_PAD + i * NODE_SPACING + ratio * NODE_SPACING;
      }
    }

    // Outside the node range: extrapolate using same px/ms rate, but cap so
    // old dates don't push content off-screen. Min X = LEFT_PAD - 2 * NODE_SPACING.
    if (t < firstNodeT) {
      const rawX = LEFT_PAD + (t - firstNodeT) * pxPerMs;
      return Math.max(rawX, LEFT_PAD - NODE_SPACING * 2);
    }
    return mainEndX + (t - lastNodeT) * pxPerMs;
  }

  // Fork X: use divergedFromDate directly (comes from GitHub compare API).
  // Fall back to lastCommitDate if missing.
  function branchForkX(b: Branch): number {
    if (b.divergedFromDate) return timeToX(b.divergedFromDate);
    return timeToX(b.lastCommitDate);
  }

  // ── Assign vertical lanes to avoid overlap ───────────────────────────────
  // Sort by fork X so nearby branches get different lanes
  const sortedByX = [...activeBranches].sort(
    (a, b) => branchForkX(a) - branchForkX(b)
  );

  // Assign lanes greedily: pick the lowest lane where this branch won't overlap
  // (simple: alternate between a few lanes based on X bucket)
  const laneCount = Math.min(activeBranches.length, 5);
  const laneAssignments = new Map<string, number>();
  sortedByX.forEach((b, i) => {
    laneAssignments.set(b.name, i % laneCount);
  });

  function laneY(b: Branch): number {
    const lane = laneAssignments.get(b.name) ?? 0;
    return MAIN_Y - LANE_HEIGHT * (lane + 1) - 40;
  }

  // Merged PRs use a lower set of lanes so they don't collide with active branches
  const MERGED_LANE_HEIGHT = 60;
  const MERGED_LANES = 4;
  const svgHeight = MAIN_Y + 120;

  return (
    <div className="relative">
    <div ref={scrollRef} className="w-full overflow-x-auto branch-map-scroll">
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ minWidth: svgWidth, display: 'block' }}
      >
        <defs>
          <filter id="tick-shadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.22" />
          </filter>
        </defs>

        {/* ── Main timeline + merge nodes — dims when a merged PR is hovered ── */}
        <g style={{ opacity: hoveredPR !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
          <line x1={LEFT_PAD} y1={MAIN_Y} x2={mainEndX} y2={MAIN_Y} stroke="#1a1a1a" strokeWidth={1.5} />
          <line x1={mainEndX} y1={MAIN_Y} x2={mainEndX + 80} y2={MAIN_Y}
            stroke="#1a1a1a" strokeWidth={1.5} strokeDasharray="6 5" />
          <text x={mainEndX + 90} y={MAIN_Y + 4} fontSize={12} fill="#1a1a1a" fontWeight={500}>
            Main
          </text>
          {sortedNodes.map((m) => {
            const x = nodeXByFullSha.get(m.fullSha) ?? timeToX(m.date);
            const label = m.prNumber ? `PR #${m.prNumber}` : m.sha;
            const title = (m.prTitle ?? '').slice(0, 22) + ((m.prTitle?.length ?? 0) > 22 ? '…' : '');
            return (
              <g key={m.fullSha}>
                <rect x={x - NODE_SIZE / 2} y={MAIN_Y - NODE_SIZE / 2}
                  width={NODE_SIZE} height={NODE_SIZE}
                  fill="white" stroke="#1a1a1a" strokeWidth={1.5} />
                <text x={x} y={MAIN_Y + 20} textAnchor="middle" fontSize={11} fill="#6b7280">{label}</text>
                <text x={x} y={MAIN_Y + 32} textAnchor="middle" fontSize={10} fill="#9ca3af">{title}</text>
                <text x={x} y={MAIN_Y + 44} textAnchor="middle" fontSize={9} fill="#9ca3af">
                  {fmtLabelDate(m.date)}
                </text>
              </g>
            );
          })}
        </g>

        {/* ── Merged PRs — interactive gray arcs ── */}
        {displayedMergedPRs.map((pr, idx) => {
          const forkX = timeToX(pr.createdAt);
          const mergeX = timeToX(pr.mergedAt);
          const lane = idx % MERGED_LANES;
          const arcY = MAIN_Y - MERGED_LANE_HEIGHT * (lane + 1);
          const shas = prCommits.get(pr.number);
          const commitCount = Math.min(shas?.length ?? pr.commitCount ?? 1, 12);
          const effectiveMergeX = Math.max(mergeX, forkX + CORNER_R * 2 + 20);

          const isHovered = hoveredPR === pr.number;
          const isDimmed = hoveredPR !== null && !isHovered;
          const opacity = isDimmed ? 0.1 : isHovered ? 0.85 : 0.38;
          const strokeColor = isHovered ? '#6b7280' : '#9ca3af';
          const strokeWidth = isHovered ? 1.6 : 1.2;

          const arcPath = [
            `M ${forkX} ${MAIN_Y}`,
            `L ${forkX} ${arcY + CORNER_R}`,
            `Q ${forkX} ${arcY} ${forkX + CORNER_R} ${arcY}`,
            `L ${effectiveMergeX - CORNER_R} ${arcY}`,
            `Q ${effectiveMergeX} ${arcY} ${effectiveMergeX} ${arcY + CORNER_R}`,
            `L ${effectiveMergeX} ${MAIN_Y}`,
          ].join(' ');

          const midX = (forkX + effectiveMergeX) / 2;
          const arcSpan = effectiveMergeX - forkX - CORNER_R * 2;
          const commitXs = Array.from({ length: commitCount }, (_, i) =>
            forkX + CORNER_R + (arcSpan * (i + 1)) / (commitCount + 1)
          );

          return (
            <g key={pr.number}
              opacity={opacity}
              style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
              onMouseEnter={() => setHoveredPR(pr.number)}
              onMouseLeave={() => { setHoveredPR(null); setHoveredPRCommit(null); }}
            >
              {/* Wide invisible stroke — extends hover target to ~12px around the arc line */}
              <path d={arcPath} fill="none" stroke="transparent" strokeWidth={20} />
              {/* Visible arc */}
              <path d={arcPath} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} style={{ pointerEvents: 'none' }} />

              <rect x={forkX - NODE_SIZE / 2} y={MAIN_Y - NODE_SIZE / 2}
                width={NODE_SIZE} height={NODE_SIZE}
                fill="white" stroke={strokeColor} strokeWidth={1} style={{ pointerEvents: 'none' }} />
              <rect x={effectiveMergeX - NODE_SIZE / 2} y={MAIN_Y - NODE_SIZE / 2}
                width={NODE_SIZE} height={NODE_SIZE}
                fill="white" stroke={strokeColor} strokeWidth={1} style={{ pointerEvents: 'none' }} />

              {/* Commit ticks — visible rect + larger transparent hit rect */}
              {commitXs.map((cx, ci) => {
                const isTickHovered = isHovered &&
                  hoveredPRCommit?.pr.number === pr.number &&
                  hoveredPRCommit?.commitIdx === ci;
                const tickSize = isTickHovered ? NODE_SIZE + 3 : NODE_SIZE - 2;
                const HIT = 20;
                return (
                  <g key={ci}>
                    {/* Visible tick */}
                    <rect
                      x={cx - tickSize / 2} y={arcY - tickSize / 2}
                      width={tickSize} height={tickSize}
                      fill={isHovered ? '#6b7280' : '#9ca3af'}
                      filter={isTickHovered ? 'url(#tick-shadow)' : undefined}
                      style={{ pointerEvents: 'none' }}
                    />
                    {/* Invisible hit area */}
                    <rect
                      x={cx - HIT / 2} y={arcY - HIT / 2}
                      width={HIT} height={HIT}
                      fill="transparent"
                      style={{ cursor: 'crosshair' }}
                      onMouseEnter={(e) => {
                        e.stopPropagation();
                        setHoveredPRCommit({ x: cx, arcY, pr, commitIdx: ci, total: commitCount });
                      }}
                      onMouseLeave={(e) => {
                        e.stopPropagation();
                        setHoveredPRCommit(null);
                      }}
                    />
                  </g>
                );
              })}

              {pr.authorAvatar ? (
                <image href={pr.authorAvatar}
                  x={midX - 10} y={arcY - 32}
                  width={18} height={18}
                  style={{ clipPath: 'circle(9px at 9px 9px)' }}
                />
              ) : (
                <circle cx={midX} cy={arcY - 22} r={8} fill="#d1d5db" />
              )}
              <text x={midX + 14} y={arcY - 18} fontSize={11} fill={isHovered ? '#374151' : '#6b7280'}>
                {pr.branchName.length > 20 ? pr.branchName.slice(0, 20) + '…' : pr.branchName}
              </text>
            </g>
          );
        })}

        {/* ── Active branches — dims when a merged PR is hovered ── */}
        <g style={{ opacity: hoveredPR !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
        {activeBranches.map((b) => {
          const forkX = branchForkX(b);
          const y = laneY(b);
          const isError = b.status === 'conflict-risk';
          const color = isError ? '#dc2626' : '#6b7280';
          const isHovered = hoveredBranch === b.name;

          const TRAIL = 80; // fixed dashed trail length in px

          // Tip X = where the last commit lands on the timeline scale.
          // If commitsAhead > 0, the last commit is at lastCommitDate.
          // Ensure tip is at least CORNER_R past the fork so the curve has room.
          const lastCommitX = timeToX(b.lastCommitDate);
          const tipX = Math.max(lastCommitX, forkX + CORNER_R + 20);

          // Smooth rounded corner path from fork point up then right to tip
          const curvePath = `M ${forkX} ${MAIN_Y} L ${forkX} ${y + CORNER_R} Q ${forkX} ${y} ${forkX + CORNER_R} ${y} L ${tipX} ${y}`;

          // Commit nodes: evenly spaced between fork+corner and tip
          const commitCount = Math.min(b.commitsAhead, 4);
          const spanWidth = tipX - (forkX + CORNER_R);
          const commitXs = Array.from({ length: commitCount }, (_, i) =>
            forkX + CORNER_R + (spanWidth * (i + 1)) / (commitCount + 1)
          );

          return (
            <g key={b.name}>
              {/* Branch path */}
              <path d={curvePath} fill="none" stroke={color} strokeWidth={1.5} />
              {/* Dashed trailing edge — exactly 80px, no canvas-edge clamping */}
              <line x1={tipX} y1={y} x2={tipX + TRAIL} y2={y}
                stroke={color} strokeWidth={1.5} strokeDasharray="6 5" />

              {/* Fork hollow square on main */}
              <rect x={forkX - NODE_SIZE / 2} y={MAIN_Y - NODE_SIZE / 2}
                width={NODE_SIZE} height={NODE_SIZE}
                fill="white" stroke={color} strokeWidth={1.5} />

              {/* Commit filled squares along branch */}
              {commitXs.map((cx, ci) => (
                <rect key={ci}
                  x={cx - NODE_SIZE / 2} y={y - NODE_SIZE / 2}
                  width={NODE_SIZE} height={NODE_SIZE}
                  fill={isError ? '#dc2626' : '#9ca3af'}
                  className="cursor-pointer"
                  onMouseEnter={() => setTooltip({
                    x: cx, y: y - 16,
                    lines: [
                      `Commit ${b.headSha?.slice(0, 7) ?? '-------'}`,
                      `@${b.lastCommitAuthor}`,
                      fmtTooltipDate(b.lastCommitDate),
                    ],
                  })}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}

              {/* Author avatar */}
              {b.lastCommitAuthorAvatar ? (
                <image href={b.lastCommitAuthorAvatar}
                  x={forkX - 10} y={y - 36}
                  width={20} height={20}
                  style={{ clipPath: 'circle(10px at 10px 10px)', borderRadius: '50%' }}
                />
              ) : (
                <circle cx={forkX} cy={y - 26} r={9} fill="#d1d5db" />
              )}

              {/* Branch name label */}
              <text
                x={forkX + 16} y={y - 22}
                fontSize={12} fill={isHovered ? '#111' : color}
                className="cursor-pointer select-none"
                onMouseEnter={() => setHoveredBranch(b.name)}
                onMouseLeave={() => setHoveredBranch(null)}
                onClick={() => router.push(`/repo/${owner}/${repo}/diff/${encodeURIComponent(b.name)}`)}
              >
                {b.name.length > 22 ? b.name.slice(0, 22) + '…' : b.name}
              </text>

              {/* Status icons below main line */}
              {b.status === 'stale' && (
                <g>
                  <title>Out of date — no commits in 14+ days</title>
                  <text x={forkX - 8} y={MAIN_Y + 62} fontSize={13}>📅</text>
                </g>
              )}
              {b.status === 'conflict-risk' && (
                <g>
                  <title>Conflict risk — branch cannot be merged cleanly</title>
                  <text x={forkX - 8} y={MAIN_Y + 62} fontSize={13} fill="#dc2626">⚠</text>
                </g>
              )}
            </g>
          );
        })}
        </g>{/* end active branches dim group */}

        {/* ── PR commit tick tooltip ── */}
        {hoveredPRCommit && (() => {
          const { x, arcY, pr, commitIdx } = hoveredPRCommit;
          const TW = 200;
          const TH = 68;
          const tx = x - TW / 2;
          const ty = arcY + 14;
          return (
            <g style={{ pointerEvents: 'none' }}>
              <rect x={tx} y={ty} width={TW} height={TH} rx={5}
                fill="white" stroke="#e5e7eb" strokeWidth={1}
                filter="url(#tick-shadow)" />
              <text x={tx + 10} y={ty + 18} fontSize={11} fontWeight={600} fill="#111827" fontFamily="monospace">
                {prCommits.get(pr.number)?.[commitIdx] ?? `commit ${commitIdx + 1}`}
              </text>
              <text x={tx + 10} y={ty + 33} fontSize={10} fill="#6b7280">
                PR #{pr.number} · {pr.branchName.length > 22 ? pr.branchName.slice(0, 22) + '…' : pr.branchName}
              </text>
              <text x={tx + 10} y={ty + 48} fontSize={10} fill="#9ca3af">
                @{pr.authorLogin} · merged {fmtLabelDate(pr.mergedAt)}
              </text>
            </g>
          );
        })()}

        {tooltip && (
          <g>
            <rect x={tooltip.x - 6} y={tooltip.y - 50}
              width={210} height={56} rx={4}
              fill="white" stroke="#e5e7eb" strokeWidth={1} />
            {tooltip.lines.map((line, i) => (
              <text key={i} x={tooltip.x + 4} y={tooltip.y - 33 + i * 16}
                fontSize={11} fontFamily="monospace"
                fill={i === 0 ? '#dc2626' : '#6b7280'}>
                {line}
              </text>
            ))}
          </g>
        )}
      </svg>

      {/* Loading indicator */}
      {loadingMore && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 flex items-center gap-2 bg-card border border-border rounded-full px-3 py-1.5 shadow-sm">
          <div className="w-3 h-3 border-2 border-border border-t-foreground rounded-full animate-spin" />
          <span className="text-xs text-muted-foreground">Loading history…</span>
        </div>
      )}
      {!hasMore && allNodes.length > 30 && (
        <p className="text-xs text-muted-foreground mt-2 pl-2">
          {allNodes.length} merge commits loaded
        </p>
      )}

    </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-card border border-border rounded-lg shadow-sm px-2 py-1.5">
        <button
          onClick={() => setZoom(z => Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100))}
          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors text-base leading-none"
          title="Zoom out"
        >
          −
        </button>
        <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom(z => Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100))}
          className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors text-base leading-none"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
