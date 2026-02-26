import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { Branch, MergeNode, MergedPR } from '../types';
import { ViewMode } from './BranchMapView';

// ── Layout constants ──────────────────────────────────────────────────────────
const LEFT_PAD = 60;
const RIGHT_PAD = 160;
const MIN_BRANCH_SPACING_X = 120;
const LANE_HEIGHT = 60;
const NODE_SIZE = 8;
const CORNER_R = 20;
const MAX_ACTIVE = 50;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type TooltipData = { x: number; y: number; lines: string[] };
type PRCommitHover = { x: number; arcY: number; pr: MergedPR; commitIdx: number; total: number };

function fmtRelativeDate(dateStr: string): string {
  const diffDays = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

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

interface BranchMapProps {
  branches: Branch[];
  mergeNodes: MergeNode[];
  mergedPRs?: MergedPR[];
  defaultBranch: string;
  selectedBranch?: Branch | null;
  onBranchSelect?: (branch: Branch) => void;
  onBranchClick?: (branch: Branch) => void;
  onLoadMore?: () => void;
  githubOwner?: string | null;
  githubRepo?: string | null;
  view?: ViewMode;
  conflictBranches?: Branch[];
  staleBranches?: Branch[];
  isLoading?: boolean;
}

export default function BranchMap({
  branches,
  mergeNodes,
  mergedPRs = [],
  defaultBranch,
  selectedBranch,
  onBranchSelect,
  onBranchClick,
  githubOwner,
  githubRepo,
  view = 'time',
  conflictBranches = [],
  staleBranches = [],
  isLoading = false,
}: BranchMapProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const [hoveredPR, setHoveredPR] = useState<number | null>(null);
  const [hoveredPRCommit, setHoveredPRCommit] = useState<PRCommitHover | null>(null);
  const [prCommits, setPrCommits] = useState<Map<number, string[]>>(new Map());
  const [zoom, setZoom] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomScrollAnchor = useRef<{
    contentX: number;
    mouseX: number;
    oldZoom: number;
  } | null>(null);

  // Bottom chrome scrollbar state
  const [barScrollLeft, setBarScrollLeft] = useState(0);
  const [barScrollMax, setBarScrollMax] = useState(0);
  const [thumbWidth, setThumbWidth] = useState(48);
  const barRangeRef = useRef<HTMLInputElement>(null);
  const [containerHeight, setContainerHeight] = useState(540);

  // PR issues panel state
  const errorBranches = [...conflictBranches, ...staleBranches];
  const [errorPanelOpen, setErrorPanelOpen] = useState(false);
  const errorPanelRef = useRef<HTMLDivElement>(null);

  // On initial mount, scroll to the right so most recent content is visible
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [mergeNodes.length]);

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
      setZoom((prev) => {
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(
          ZOOM_MIN,
          Math.min(ZOOM_MAX, Math.round((prev + delta) * 100) / 100)
        );
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
        const scaledX =
          LEFT_PAD + (anchor.contentX - LEFT_PAD) * (zoom / anchor.oldZoom);
        scrollRef.current.scrollLeft = scaledX - anchor.mouseX;
      }
    });
  }, [zoom]);

  // Sync bottom chrome scrollbar + track container height
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const syncBar = () => {
      const max = Math.max(0, el.scrollWidth - el.clientWidth);
      setBarScrollLeft(el.scrollLeft);
      setBarScrollMax(max);
      if (el.clientHeight > 0) setContainerHeight(el.clientHeight);
      const rangeEl = barRangeRef.current;
      if (rangeEl && rangeEl.offsetWidth > 0) {
        const ratio = el.scrollWidth > 0 ? el.clientWidth / el.scrollWidth : 1;
        setThumbWidth(Math.max(24, Math.round(rangeEl.offsetWidth * ratio)));
      }
    };
    el.addEventListener('scroll', syncBar, { passive: true });
    const ro = new ResizeObserver(syncBar);
    ro.observe(el);
    syncBar();
    return () => {
      el.removeEventListener('scroll', syncBar);
      ro.disconnect();
    };
  }, []);

  // Fetch real commit SHAs for merged PRs
  useEffect(() => {
    if (!githubOwner || !githubRepo || mergedPRs.length === 0) return;

    const prNumbers = mergedPRs.map(pr => pr.number);
    invoke<Record<number, string[]>>('get_pr_commits', {
      owner: githubOwner,
      repo: githubRepo,
      prNumbers,
    })
      .then((data) => {
        setPrCommits(new Map(Object.entries(data).map(([k, v]) => [parseInt(k), v])));
      })
      .catch(() => {
        // Silently fail - tooltips will just not show SHAs
      });
  }, [githubOwner, githubRepo, mergedPRs]);

  // Close error panel on outside click
  useEffect(() => {
    if (!errorPanelOpen) return;
    const handler = (e: MouseEvent) => {
      if (!errorPanelRef.current?.contains(e.target as Node)) setErrorPanelOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [errorPanelOpen]);

  // ── Separate active vs merged branches ──────────────────────────────────────
  const STATUS_PRIORITY: Record<string, number> = { 'conflict-risk': 0, stale: 1, fresh: 2, unknown: 3 };
  const mergedBranchDates = new Map(mergedPRs.map(pr => [pr.branchName, pr.mergedAt]));
  const activeBranches = branches
    .filter(b => {
      if (b.name === defaultBranch) return false;
      const mergedAt = mergedBranchDates.get(b.name);
      if (!mergedAt) return true;
      // Show if the branch has been updated after the PR was merged (new branch, same name)
      return new Date(b.lastCommitDate) > new Date(mergedAt);
    })
    .sort((a, b) => {
      if (view === 'status') {
        const diff = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
        return diff !== 0 ? diff : new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
      }
      if (view === 'creator') {
        const diff = a.lastCommitAuthor.localeCompare(b.lastCommitAuthor);
        return diff !== 0 ? diff : new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
      }
      // 'time': most recently committed first
      return new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime();
    })
    .slice(0, MAX_ACTIVE);

  // ── Animation delays: sort all arcs newest → oldest, stagger after main line ─
  const MAIN_DRAW_MS = 1400;
  const STAGGER_MS = 70;
  const INFO_OFFSET = 600; // ms after arc starts drawing before info fades in
  const arcDelayMs = new Map<string, number>(
    [
      ...mergedPRs.map(pr => ({ key: `pr-${pr.number}`, date: pr.mergedAt })),
      ...activeBranches.map(b => ({ key: `br-${b.name}`, date: b.lastCommitDate })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .map(({ key }, i) => [key, MAIN_DRAW_MS + i * STAGGER_MS] as [string, number])
  );

  // ── Build a date → X mapping ─────────────────────────────────────────────
  const NODE_SPACING = Math.max(MIN_BRANCH_SPACING_X, Math.round(160 * zoom));

  const sortedNodes = [...mergeNodes].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  const nodeXByFullSha = new Map<string, number>();
  sortedNodes.forEach((m, i) => {
    nodeXByFullSha.set(m.fullSha, LEFT_PAD + i * NODE_SPACING);
  });

  const mainEndX =
    LEFT_PAD + Math.max(sortedNodes.length - 1, 0) * NODE_SPACING;

  const firstNodeT =
    sortedNodes.length > 0
      ? new Date(sortedNodes[0].date).getTime()
      : Date.now();
  const lastNodeT =
    sortedNodes.length > 1
      ? new Date(sortedNodes[sortedNodes.length - 1].date).getTime()
      : firstNodeT + 1;
  const nodeTimeSpan = Math.max(lastNodeT - firstNodeT, 1);
  const pxPerMs = (mainEndX - LEFT_PAD) / nodeTimeSpan;

  function timeToX(dateStr: string): number {
    const t = new Date(dateStr).getTime();
    if (sortedNodes.length === 0) return LEFT_PAD;

    for (let i = 0; i < sortedNodes.length - 1; i++) {
      const tA = new Date(sortedNodes[i].date).getTime();
      const tB = new Date(sortedNodes[i + 1].date).getTime();
      if (t >= tA && t <= tB) {
        const ratio = (t - tA) / (tB - tA);
        return LEFT_PAD + i * NODE_SPACING + ratio * NODE_SPACING;
      }
    }

    if (t < firstNodeT) {
      const rawX = LEFT_PAD + (t - firstNodeT) * pxPerMs;
      return Math.max(rawX, LEFT_PAD - NODE_SPACING * 2);
    }
    return mainEndX + (t - lastNodeT) * pxPerMs;
  }

  function branchForkX(b: Branch): number {
    if (b.divergedFromDate) return timeToX(b.divergedFromDate);
    return timeToX(b.lastCommitDate);
  }

  // ── Assign vertical lanes to avoid overlap ───────────────────────────────
  const sortedByX = [...activeBranches].sort(
    (a, b) => branchForkX(a) - branchForkX(b)
  );

  const laneCount = Math.min(activeBranches.length, 5);
  const laneAssignments = new Map<string, number>();
  sortedByX.forEach((b, i) => {
    laneAssignments.set(b.name, i % laneCount);
  });

  // Dynamic main Y based on container height
  const mainY = Math.max(440, containerHeight - 120);

  function laneY(b: Branch): number {
    const lane = laneAssignments.get(b.name) ?? 0;
    return mainY - LANE_HEIGHT * (lane + 1) - 40;
  }

  // Calculate SVG dimensions
  const maxBranchTipX = activeBranches.reduce((max, b) => {
    const fx = branchForkX(b);
    const tipX = Math.max(timeToX(b.lastCommitDate), fx + CORNER_R + 20);
    return Math.max(max, tipX + 80);
  }, mainEndX);
  const svgWidth = maxBranchTipX + RIGHT_PAD + 80;

  // Merged PRs lane layout
  const MERGED_LANE_HEIGHT = 60;
  const MERGED_LANES = 4;
  const svgHeight = Math.max(mainY + 120, containerHeight);

  return (
    <div className="h-full">
      <div
        ref={scrollRef}
        className="w-full h-full overflow-x-auto overflow-y-hidden branch-map-scroll relative"
      >
        <svg
          ref={svgRef}
          width={svgWidth}
          height={svgHeight}
          style={{ minWidth: svgWidth, display: 'block' }}
        >
          <defs>
            <filter id="tick-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.22" />
            </filter>
          </defs>

          {/* ── Main timeline + merge nodes ── */}
          <g style={{ opacity: hoveredPR !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
            <line
              x1={LEFT_PAD}
              y1={mainY}
              x2={mainEndX}
              y2={mainY}
              stroke="#a8a29e"
              strokeWidth={1.5}
              pathLength={1}
              className="draw-path-main"
            />

            {/* Dashed extension, label, and ticks — fade in once the line is drawn */}
            <g className="fade-in-info" style={{ '--delay': `${MAIN_DRAW_MS}ms` } as React.CSSProperties}>
              <line
                x1={mainEndX}
                y1={mainY}
                x2={mainEndX + 80}
                y2={mainY}
                stroke="#a8a29e"
                strokeWidth={1.5}
                strokeDasharray="6 5"
              />
              <text
                x={mainEndX + 90}
                y={mainY + 4}
                fontSize={12}
                fill="#e7e5e4"
                fontWeight={500}
              >
                {defaultBranch}
              </text>
              {sortedNodes.map((m) => {
                const x = nodeXByFullSha.get(m.fullSha) ?? timeToX(m.date);
                const label = m.prNumber ? `PR #${m.prNumber}` : m.sha;
                const title =
                  (m.prTitle ?? '').slice(0, 22) +
                  ((m.prTitle?.length ?? 0) > 22 ? '…' : '');
                return (
                  <g key={m.fullSha}>
                    <rect
                      x={x - NODE_SIZE / 2}
                      y={mainY - NODE_SIZE / 2}
                      width={NODE_SIZE}
                      height={NODE_SIZE}
                      fill="#1c1917"
                      stroke="#a8a29e"
                      strokeWidth={1.5}
                    />
                    <text
                      x={x}
                      y={mainY + 20}
                      textAnchor="middle"
                      fontSize={11}
                      fill="#a8a29e"
                    >
                      {label}
                    </text>
                    <text
                      x={x}
                      y={mainY + 32}
                      textAnchor="middle"
                      fontSize={10}
                      fill="#78716c"
                    >
                      {title}
                    </text>
                    <text
                      x={x}
                      y={mainY + 44}
                      textAnchor="middle"
                      fontSize={9}
                      fill="#78716c"
                    >
                      {fmtLabelDate(m.date)}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>

          {/* ── Merged PRs — interactive arcs ── */}
          {mergedPRs.map((pr, idx) => {
            const forkX = timeToX(pr.createdAt);
            const mergeX = timeToX(pr.mergedAt);
            const lane = idx % MERGED_LANES;
            const arcY = mainY - MERGED_LANE_HEIGHT * (lane + 1);
            const shas = prCommits.get(pr.number);
            const commitCount = Math.min(shas?.length ?? pr.commitCount ?? 1, 12);
            const effectiveMergeX = Math.max(mergeX, forkX + CORNER_R * 2 + 20);

            const isHovered = hoveredPR === pr.number;
            const isDimmed = hoveredPR !== null && !isHovered;
            const opacity = isDimmed ? 0.1 : isHovered ? 0.85 : 0.38;
            const strokeColor = isHovered ? '#a8a29e' : '#78716c';
            const strokeWidth = isHovered ? 1.6 : 1.2;

            const arcPath = [
              `M ${forkX} ${mainY}`,
              `L ${forkX} ${arcY + CORNER_R}`,
              `Q ${forkX} ${arcY} ${forkX + CORNER_R} ${arcY}`,
              `L ${effectiveMergeX - CORNER_R} ${arcY}`,
              `Q ${effectiveMergeX} ${arcY} ${effectiveMergeX} ${arcY + CORNER_R}`,
              `L ${effectiveMergeX} ${mainY}`,
            ].join(' ');

            const midX = (forkX + effectiveMergeX) / 2;
            const arcSpan = effectiveMergeX - forkX - CORNER_R * 2;
            const commitXs = Array.from({ length: commitCount }, (_, i) =>
              forkX + CORNER_R + (arcSpan * (i + 1)) / (commitCount + 1)
            );

            const prDelay = arcDelayMs.get(`pr-${pr.number}`) ?? 0;

            return (
              <g
                key={pr.number}
                opacity={opacity}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHoveredPR(pr.number)}
                onMouseLeave={() => { setHoveredPR(null); setHoveredPRCommit(null); }}
              >
                {/* Wide invisible stroke for hover */}
                <path d={arcPath} fill="none" stroke="transparent" strokeWidth={20} />
                {/* Visible arc — draws in */}
                <path
                  d={arcPath}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  pathLength={1}
                  className="draw-path-arc"
                  style={{ pointerEvents: 'none', '--delay': `${prDelay}ms` } as React.CSSProperties}
                />

                {/* Arc info — fades in as arc draws */}
                <g className="fade-in-info" style={{ '--delay': `${prDelay + INFO_OFFSET}ms` } as React.CSSProperties}>
                  <rect x={forkX - NODE_SIZE / 2} y={mainY - NODE_SIZE / 2}
                    width={NODE_SIZE} height={NODE_SIZE}
                    fill="#1c1917" stroke={strokeColor} strokeWidth={1} style={{ pointerEvents: 'none' }} />
                  <rect x={effectiveMergeX - NODE_SIZE / 2} y={mainY - NODE_SIZE / 2}
                    width={NODE_SIZE} height={NODE_SIZE}
                    fill="#1c1917" stroke={strokeColor} strokeWidth={1} style={{ pointerEvents: 'none' }} />

                  {/* Commit ticks — interactive with SHA tooltips */}
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
                          x={cx - tickSize / 2}
                          y={arcY - tickSize / 2}
                          width={tickSize}
                          height={tickSize}
                          fill={isHovered ? '#a8a29e' : '#78716c'}
                          style={{ pointerEvents: 'none', transition: 'all 0.1s' }}
                        />
                        {/* Invisible hit area */}
                        <rect
                          x={cx - HIT / 2}
                          y={arcY - HIT / 2}
                          width={HIT}
                          height={HIT}
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

                  {/* Author avatar */}
                  {pr.authorAvatar ? (
                    <image
                      href={pr.authorAvatar}
                      x={midX - 10}
                      y={arcY - 32}
                      width={18}
                      height={18}
                      style={{ clipPath: 'circle(9px at 9px 9px)' }}
                    />
                  ) : (
                    <circle cx={midX} cy={arcY - 22} r={8} fill="#57534e" />
                  )}
                  <text x={midX + 14} y={arcY - 18} fontSize={11} fill={isHovered ? '#e7e5e4' : '#a8a29e'}>
                    {pr.branchName.length > 20 ? pr.branchName.slice(0, 20) + '…' : pr.branchName}
                  </text>
                </g>
              </g>
            );
          })}

          {/* ── Active branches ── */}
          <g style={{ opacity: hoveredPR !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
            {activeBranches.map((b) => {
              const forkX = branchForkX(b);
              const y = laneY(b);
              const isConflict = b.status === 'conflict-risk';
              const isStale = b.status === 'stale';
              const isSelected = selectedBranch?.name === b.name;
              const isHovered = hoveredBranch === b.name;
              const hasSelection = selectedBranch != null;

              const color = isSelected
                ? '#22d3ee'
                : isConflict
                ? '#dc2626'
                : isStale
                ? '#d97706'
                : hasSelection
                ? '#57534e'
                : '#a8a29e';
              const strokeWidth = isSelected ? 2.5 : 1.5;

              const TRAIL = 80;
              const lastCommitX = timeToX(b.lastCommitDate);
              const tipX = Math.max(lastCommitX, forkX + CORNER_R + 20);
              const curvePath = `M ${forkX} ${mainY} L ${forkX} ${y + CORNER_R} Q ${forkX} ${y} ${forkX + CORNER_R} ${y} L ${tipX} ${y}`;

              const commitCount = Math.min(b.commitsAhead, 4);
              const spanWidth = tipX - (forkX + CORNER_R);
              const commitXs = Array.from({ length: commitCount }, (_, i) =>
                forkX + CORNER_R + (spanWidth * (i + 1)) / (commitCount + 1)
              );

              const brDelay = arcDelayMs.get(`br-${b.name}`) ?? 0;

              return (
                <g
                  key={b.name}
                  className="cursor-pointer"
                  onClick={() => onBranchSelect?.(b)}
                  onDoubleClick={() => onBranchClick?.(b)}
                  style={{ opacity: hasSelection && !isSelected ? 0.5 : 1 }}
                >
                  {/* Glow effect for selected branch */}
                  {isSelected && (
                    <path
                      d={curvePath}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth={8}
                      strokeOpacity={0.25}
                      style={{ filter: 'blur(4px)' }}
                    />
                  )}
                  {/* Branch path — draws in */}
                  <path
                    d={curvePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    pathLength={1}
                    className="draw-path-arc"
                    style={{ '--delay': `${brDelay}ms` } as React.CSSProperties}
                  />

                  {/* Branch info — fades in as arc draws */}
                  <g className="fade-in-info" style={{ '--delay': `${brDelay + INFO_OFFSET}ms` } as React.CSSProperties}>
                    {/* Dashed trailing edge */}
                    <line
                      x1={tipX}
                      y1={y}
                      x2={tipX + TRAIL}
                      y2={y}
                      stroke={color}
                      strokeWidth={strokeWidth}
                      strokeDasharray="6 5"
                    />

                    {/* Fork hollow square on main */}
                    <rect
                      x={forkX - NODE_SIZE / 2}
                      y={mainY - NODE_SIZE / 2}
                      width={NODE_SIZE}
                      height={NODE_SIZE}
                      fill={isSelected ? '#22d3ee' : '#1c1917'}
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                    {/* Branch name label below main line */}
                    <text x={forkX} y={mainY + 20} textAnchor="middle" fontSize={10} fill="#78716c">
                      {b.name.length > 18 ? b.name.slice(0, 18) + '…' : b.name}
                    </text>

                    {/* Commit filled squares along branch */}
                    {commitXs.map((cx, ci) => (
                      <rect
                        key={ci}
                        x={cx - NODE_SIZE / 2}
                        y={y - NODE_SIZE / 2}
                        width={NODE_SIZE}
                        height={NODE_SIZE}
                        fill={isSelected ? '#22d3ee' : isConflict ? '#dc2626' : isStale ? '#d97706' : '#78716c'}
                        onMouseEnter={() =>
                          setTooltip({
                            x: cx,
                            y: y - 16,
                            lines: [
                              `Commit ${b.headSha?.slice(0, 7) ?? '-------'}`,
                              `@${b.lastCommitAuthor}`,
                              fmtTooltipDate(b.lastCommitDate),
                            ],
                          })
                        }
                        onMouseLeave={() => setTooltip(null)}
                      />
                    ))}

                    {/* Author initial circle */}
                    <circle cx={forkX} cy={y - 26} r={9} fill={isSelected ? '#0891b2' : '#57534e'} />
                    <text
                      x={forkX}
                      y={y - 22}
                      textAnchor="middle"
                      fontSize={10}
                      fill={isSelected ? '#ecfeff' : '#e7e5e4'}
                      fontWeight={500}
                    >
                      {b.lastCommitAuthor?.charAt(0).toUpperCase() || '?'}
                    </text>

                    {/* Branch name label */}
                    <text
                      x={forkX + 16}
                      y={y - 22}
                      fontSize={isSelected ? 13 : 12}
                      fontWeight={isSelected ? 600 : 400}
                      fill={isSelected ? '#22d3ee' : isHovered ? '#fafaf9' : color}
                      className="select-none"
                      onMouseEnter={() => setHoveredBranch(b.name)}
                      onMouseLeave={() => setHoveredBranch(null)}
                    >
                      {b.name.length > 22 ? b.name.slice(0, 22) + '…' : b.name}
                    </text>

                    {/* Commits ahead badge */}
                    <text
                      x={tipX + TRAIL + 10}
                      y={y + 4}
                      fontSize={10}
                      fill="#78716c"
                    >
                      +{b.commitsAhead}
                    </text>
                  </g>

                    {/* Status labels below main line */}
                    {isStale && (
                      <text x={forkX} y={mainY + 34} textAnchor="middle" fontSize={10} fill="#d97706">
                        stale
                      </text>
                    )}
                    {isConflict && (
                      <text x={forkX} y={mainY + 34} textAnchor="middle" fontSize={10} fill="#dc2626">
                        conflict
                      </text>
                    )}
                </g>
              );
            })}
          </g>

          {/* Tooltip for branch commits */}
          {tooltip && (
            <g>
              <rect
                x={tooltip.x - 6}
                y={tooltip.y - 50}
                width={210}
                height={56}
                rx={4}
                fill="#292524"
                stroke="#44403c"
                strokeWidth={1}
              />
              {tooltip.lines.map((line, i) => (
                <text
                  key={i}
                  x={tooltip.x + 4}
                  y={tooltip.y - 33 + i * 16}
                  fontSize={11}
                  fontFamily="monospace"
                  fill={i === 0 ? '#ef4444' : '#a8a29e'}
                >
                  {line}
                </text>
              ))}
            </g>
          )}

          {/* Tooltip for PR commit SHAs — positioned below the tick */}
          {hoveredPRCommit && (() => {
            const { x, arcY, pr, commitIdx } = hoveredPRCommit;
            const sha = prCommits.get(pr.number)?.[commitIdx];
            const TW = 200;
            const TH = 68;
            const tx = x - TW / 2;
            const ty = arcY + 14;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect x={tx} y={ty} width={TW} height={TH} rx={5}
                  fill="#292524" stroke="#44403c" strokeWidth={1}
                  filter="url(#tick-shadow)" />
                <text x={tx + 10} y={ty + 18} fontSize={11} fontWeight={600} fill="#22d3ee" fontFamily="monospace">
                  {sha ?? `commit ${commitIdx + 1}`}
                </text>
                <text x={tx + 10} y={ty + 33} fontSize={10} fill="#a8a29e">
                  PR #{pr.number} · {pr.branchName.length > 22 ? pr.branchName.slice(0, 22) + '…' : pr.branchName}
                </text>
                <text x={tx + 10} y={ty + 48} fontSize={10} fill="#78716c">
                  @{pr.authorLogin} · merged {fmtLabelDate(pr.mergedAt)}
                </text>
              </g>
            );
          })()}
        </svg>

        {/* Empty state */}
        {sortedNodes.length === 0 && activeBranches.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            No branches or merge commits found
          </div>
        )}
      </div>

      {/* Fixed bottom chrome: PR issues button + scrollbar + zoom */}
      <div className="fixed bottom-6 left-6 right-6 flex flex-col gap-2 z-50">

        {/* PR issues button — above scrollbar, right-aligned */}
        {errorBranches.length > 0 && (
          <div className="flex justify-end">
            <button
              onClick={() => setErrorPanelOpen((o) => !o)}
              className={`flex items-center gap-1.5 text-xs border rounded-full px-3 py-1 transition-colors ${
                errorPanelOpen
                  ? 'text-destructive border-destructive/40 bg-destructive/10'
                  : 'text-destructive border-destructive/20 bg-destructive/5 hover:bg-destructive/10'
              }`}
            >
              ⚠ {errorBranches.length} PR issue{errorBranches.length !== 1 ? 's' : ''}
            </button>
          </div>
        )}

        {/* Scrollbar + zoom row */}
        <div
          className="flex items-center gap-4"
          style={{
            opacity: isLoading ? 0 : 1,
            transition: 'opacity 0.4s ease',
          }}
        >
          <input
            ref={barRangeRef}
            type="range"
            min={0}
            max={Math.max(1, barScrollMax)}
            value={barScrollLeft}
            style={{ ['--thumb-w' as string]: `${thumbWidth}px` }}
            onChange={(e) => {
              if (scrollRef.current) scrollRef.current.scrollLeft = Number(e.target.value);
            }}
            className="bottom-scroll-range flex-1"
          />
          <div className="flex items-center gap-2 shrink-0 bg-card border border-border rounded-full px-3 py-1">
            <button
              onClick={() => setZoom(z => Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100))}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors leading-none select-none"
              title="Zoom out"
            >
              −
            </button>
            <span className="text-xs text-muted-foreground w-10 text-center tabular-nums select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom(z => Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100))}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors leading-none select-none"
              title="Zoom in"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* PR issues panel — slides in from right */}
      <div
        ref={errorPanelRef}
        className={`fixed right-4 top-14 bottom-6 w-72 flex flex-col bg-card/90 backdrop-blur-sm rounded-2xl border border-border shadow-lg z-40 transition-all duration-300 ease-in-out ${
          errorPanelOpen ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 shrink-0">
          <span className="text-sm font-medium text-foreground">PR issues</span>
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
                Merge conflicts
              </p>
              {conflictBranches.map(b => (
                <div
                  key={b.name}
                  onClick={() => onBranchClick?.(b)}
                  className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors cursor-pointer"
                >
                  <span className="mt-0.5 w-2 h-2 rounded-full bg-destructive shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.lastCommitAuthor ? `${b.lastCommitAuthor} · ` : ''}{fmtRelativeDate(b.lastCommitDate)}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}

          {staleBranches.length > 0 && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium px-4 pt-3 pb-1">
                Stale PRs
              </p>
              {staleBranches.map(b => (
                <div
                  key={b.name}
                  onClick={() => onBranchClick?.(b)}
                  className="flex items-start gap-2.5 px-4 py-2.5 hover:bg-accent transition-colors cursor-pointer"
                >
                  <span className="mt-0.5 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{b.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {b.lastCommitAuthor ? `${b.lastCommitAuthor} · ` : ''}{fmtRelativeDate(b.lastCommitDate)}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
