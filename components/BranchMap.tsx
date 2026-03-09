import React, { useState, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X } from 'lucide-react';
import { Branch, DirectCommit, MergeNode, MergedPR, OpenPR } from '../types';
import { ViewMode } from './BranchMapView';

// ── Layout constants ──────────────────────────────────────────────────────────
const LEFT_PAD = 60;
const RIGHT_PAD = 160;
const MIN_BRANCH_SPACING_X = 30;
const LANE_HEIGHT = 60;
const NODE_SIZE = 8;
const CORNER_R = 20;
const MAX_ACTIVE = 50;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;

type TooltipData = { x: number; y: number; lines: string[] };
type PRCommitHover = { x: number; arcY: number; pr: MergedPR; commitIdx: number; total: number };

function smoothScrollTo(el: HTMLElement, targetLeft: number, durationMs: number) {
  const startLeft = el.scrollLeft;
  const delta = targetLeft - startLeft;
  if (Math.abs(delta) < 1) return;
  const startTime = performance.now();
  function easeInOutCubic(t: number) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }
  function step(now: number) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / durationMs);
    el.scrollLeft = startLeft + delta * easeInOutCubic(t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

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
  directCommits?: DirectCommit[];
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
  inactiveErrorBranches?: Branch[];
  openPRs?: OpenPR[];
  isLoading?: boolean;
  scrollRequest?: { branch: Branch; seq: number } | null;
  focusedErrorBranch?: Branch | null;
}

export default function BranchMap({
  branches,
  mergeNodes,
  directCommits = [],
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
  inactiveErrorBranches = [],
  openPRs = [],
  isLoading = false,
  scrollRequest,
  focusedErrorBranch,
}: BranchMapProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const [hoveredPR, setHoveredPR] = useState<number | null>(null);
  const [hoveredPRCommit, setHoveredPRCommit] = useState<PRCommitHover | null>(null);
  const [hoveredMergeNode, setHoveredMergeNode] = useState<{ x: number; node: MergeNode } | null>(null);
  const [prCommits, setPrCommits] = useState<Map<number, string[]>>(new Map());
  const [zoom, setZoom] = useState(1);
  // WKWebView (Tauri) doesn't fire CSS animations on SVG elements inserted during
  // the initial paint. Defer animation classes by one rAF so they start post-paint.
  const [drawReady, setDrawReady] = useState(false);
  // flashingName: branch in "bright" phase right after focus (clears after 700ms, triggering CSS stroke transition to lighter red)
  const [_flashingName, setFlashingName] = useState<string | null>(null);

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
  const [scrollbarReady, setScrollbarReady] = useState(false);
  const barRangeRef = useRef<HTMLInputElement>(null);
  const [containerHeight, setContainerHeight] = useState(540);

  // PR issues panel state
  const [errorPanelOpen, setErrorPanelOpen] = useState(false);
  const errorPanelRef = useRef<HTMLDivElement>(null);

  // Inactive error branches render grey (no status colors)
  const inactiveErrorSet = new Set(inactiveErrorBranches.map(b => b.name));
  const openPRBranchNames = new Set(openPRs.map(p => p.branchName));

  // Trigger draw-in animations when merge nodes first arrive (not on mount),
  // so the timeline always animates in even when the map view is shown before data loads.
  const hadDataRef = useRef(false);
  useEffect(() => {
    // Reset when data is cleared (new repo selected) so animations retrigger.
    if (mergeNodes.length === 0) {
      hadDataRef.current = false;
      setDrawReady(false);
      return;
    }
    if (hadDataRef.current) return;
    hadDataRef.current = true;

    // Use a cancelled flag so React StrictMode's cleanup can invalidate the
    // first invocation's callbacks before the second invocation schedules its own.
    let cancelled = false;
    let id1: number, id2: number;
    id1 = requestAnimationFrame(() => {
      if (cancelled) return;
      id2 = requestAnimationFrame(() => {
        if (cancelled) return;
        setDrawReady(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
      // Reset so the re-invocation (StrictMode second mount) can trigger normally.
      hadDataRef.current = false;
    };
  }, [mergeNodes.length]);

  // Scroll to the right when data loads so most recent content is visible.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [mergeNodes.length]);

  // Reveal the scrollbar after the main draw-in animation completes.
  // drawReady fires when animations start; 2600ms matches draw-path-main duration.
  // When drawReady resets (new repo), hide the scrollbar immediately so it
  // doesn't flash visible before the next animation cycle begins.
  useEffect(() => {
    if (!drawReady) {
      setScrollbarReady(false);
      return;
    }
    const id = setTimeout(() => setScrollbarReady(true), 2600);
    return () => clearTimeout(id);
  }, [drawReady]);

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

  // Scroll timeline to the requested branch. Set flashingName briefly so the arc
  // starts bright red, then CSS stroke transition fades it to the settled lighter red.
  useEffect(() => {
    if (!scrollRequest || !scrollRef.current) return;
    const { branch } = scrollRequest;
    const x = branch.divergedFromDate
      ? timeToX(branch.divergedFromDate)
      : timeToX(branch.lastCommitDate);
    const viewWidth = scrollRef.current.clientWidth;
    smoothScrollTo(scrollRef.current, Math.max(0, x - viewWidth / 2), 600);
    setFlashingName(branch.name);
    const t = setTimeout(() => setFlashingName(null), 700);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

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

  // ── Animation delays — branches and PRs computed independently ───────────
  // Keeping them separate means adding mergedPRs (async GitHub data) never
  // changes branch delays mid-animation, which would restart their CSS animation.
  const MAIN_DRAW_MS = 1400;
  const STAGGER_MS   = 70;
  const INFO_OFFSET  = 600; // ms after arc starts drawing before info fades in

  const branchDelayMs = new Map<string, number>(
    [...activeBranches]
      .sort((a, b) => new Date(b.lastCommitDate).getTime() - new Date(a.lastCommitDate).getTime())
      .map((b, i) => [b.name, MAIN_DRAW_MS + i * STAGGER_MS] as [string, number])
  );

  const prDelayMs = new Map<number, number>(
    [...mergedPRs]
      .sort((a, b) => new Date(b.mergedAt).getTime() - new Date(a.mergedAt).getTime())
      .map((pr, i) => [pr.number, MAIN_DRAW_MS + i * STAGGER_MS] as [number, number])
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

  // When extrapolating dates outside the merge-node range, use a rate capped at
  // 1 NODE_SPACING per 7 days. This prevents active branches on fast-moving repos
  // (many PRs merged within hours) from extending far off the right edge.
  const avgNodeIntervalMs = sortedNodes.length > 1
    ? nodeTimeSpan / (sortedNodes.length - 1)
    : 7 * 86400000;
  const safeExtrapPxPerMs = NODE_SPACING / Math.max(avgNodeIntervalMs, 7 * 86400000);

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
      const rawX = LEFT_PAD + (t - firstNodeT) * safeExtrapPxPerMs;
      return Math.max(rawX, LEFT_PAD - NODE_SPACING * 2);
    }
    return mainEndX + (t - lastNodeT) * safeExtrapPxPerMs;
  }

  function branchForkX(b: Branch): number {
    if (b.divergedFromDate) return timeToX(b.divergedFromDate);
    return timeToX(b.lastCommitDate);
  }

  // SVG width: extend past mainEndX if any branch tip falls further right
  // (e.g. a fresh branch with no commits sits at today's date, past the last PR).
  const maxBranchTipX = activeBranches.reduce((max, b) => {
    const fx = branchForkX(b);
    const tipX = Math.max(timeToX(b.lastCommitDate), fx + CORNER_R + 20);
    return Math.max(max, tipX + 80);
  }, mainEndX);
  const svgWidth = maxBranchTipX + RIGHT_PAD + 80;

  // Dynamic main Y: positions the main timeline proportional to available height.
  // 120px reserved below for node labels; minimum 440 so all 5 lanes fit above.
  const mainY = Math.max(440, containerHeight - 120);

  // ── Assign vertical lanes to avoid overlap ───────────────────────────────
  const sortedByX = [...activeBranches].sort(
    (a, b) => branchForkX(a) - branchForkX(b)
  );

  const laneCount = Math.min(activeBranches.length, 5);
  const laneAssignments = new Map<string, number>();
  sortedByX.forEach((b, i) => {
    laneAssignments.set(b.name, i % laneCount);
  });

  function laneY(b: Branch): number {
    const lane = laneAssignments.get(b.name) ?? 0;
    return mainY - LANE_HEIGHT * (lane + 1) - 40;
  }

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
          className={drawReady ? 'timeline-ready' : ''}
          style={{ minWidth: svgWidth, display: 'block' }}
        >
          <defs>
            <filter id="tick-shadow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="2" stdDeviation="6" floodColor="#000" floodOpacity="0.08" />
            </filter>
          </defs>

          {/* ── Main timeline + merge nodes ── */}
          <g style={{ opacity: hoveredPR !== null || hoveredBranch !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
            {/* Use <path> not <line>: pathLength on <line> is SVG 2 only and unreliable in WKWebView */}
            <path
              d={`M ${LEFT_PAD} ${mainY} L ${mainEndX} ${mainY}`}
              fill="none"
              stroke="#78716c"
              strokeWidth={1.5}
              pathLength={1}
              className="draw-path-main"
            />

            {/* Dashed extension, label, and ticks — fade in once the line is drawn */}
            <g className="fade-in-info" style={{ '--delay': `${MAIN_DRAW_MS}ms` } as React.CSSProperties}>
              <line
                x1={mainEndX}
                y1={mainY}
                x2={svgWidth - RIGHT_PAD}
                y2={mainY}
                stroke="#78716c"
                strokeWidth={1.5}
                strokeDasharray="6 5"
              />
              <text
                x={svgWidth - RIGHT_PAD + 10}
                y={mainY + 4}
                fontSize={12}
                fill="#1c1917"
                fontWeight={500}
              >
                {defaultBranch}
              </text>

              {/* Direct commits — small dots between merge nodes */}
              {directCommits
                .filter(c => {
                  const t = new Date(c.date).getTime();
                  return t >= firstNodeT && t <= lastNodeT;
                })
                .map(c => {
                  const x = timeToX(c.date);
                  const label = c.message.length > 38 ? c.message.slice(0, 38) + '…' : c.message;
                  return (
                    <rect
                      key={c.fullSha}
                      x={x - 3}
                      y={mainY - 3}
                      width={6}
                      height={6}
                      fill="#57534e"
                      style={{ cursor: 'default' }}
                      onMouseEnter={() =>
                        setTooltip({
                          x,
                          y: mainY - 16,
                          lines: [c.sha, label, `@${c.author}`],
                        })
                      }
                      onMouseLeave={() => setTooltip(null)}
                    />
                  );
                })}

              {(() => {
                // Progressive label culling as zoom decreases.
                // Step 1: decide which content lines to show based on node spacing.
                //   ≥130px → full (PR#, title, date)
                //   ≥80px  → medium (PR#, date — no title)
                //   ≥40px  → minimal (PR# only)
                //   <40px  → no labels at all (hover tooltip still works)
                // Step 2: min gap between shown labels = width of the widest line
                //   being rendered, so labels never overlap their neighbours.
                const showTitle  = NODE_SPACING >= 130;
                const showDate   = NODE_SPACING >= 80;
                const anyLabel   = NODE_SPACING >= 40;
                const minLabelGap = showTitle ? 130 : showDate ? 100 : anyLabel ? 55 : Infinity;

                let lastLabelX = -Infinity;
                return sortedNodes.map((m) => {
                  const x = nodeXByFullSha.get(m.fullSha) ?? timeToX(m.date);
                  const showLabel = anyLabel && x - lastLabelX >= minLabelGap;
                  if (showLabel) lastLabelX = x;
                  const label = m.prNumber ? `PR #${m.prNumber}` : m.sha.slice(0, 7);
                  const isHovered = hoveredMergeNode?.node.fullSha === m.fullSha;
                  const HIT = 20;
                  return (
                    <g key={m.fullSha}>
                      {/* Visible tick — pointer-events off so hit rect handles hover */}
                      <rect
                        x={x - NODE_SIZE / 2}
                        y={mainY - NODE_SIZE / 2}
                        width={NODE_SIZE}
                        height={NODE_SIZE}
                        rx={2}
                        fill="#fafaf9"
                        stroke={isHovered ? '#44403c' : '#78716c'}
                        strokeWidth={isHovered ? 2 : 1.5}
                        style={{ pointerEvents: 'none', transition: 'stroke 0.1s' }}
                      />
                      {/* Transparent hit area for hover — rendered on top */}
                      <rect
                        x={x - HIT / 2}
                        y={mainY - HIT / 2}
                        width={HIT}
                        height={HIT}
                        fill="transparent"
                        style={{ cursor: 'default' }}
                        onMouseEnter={() => setHoveredMergeNode({ x, node: m })}
                        onMouseLeave={() => setHoveredMergeNode(null)}
                      />
                      {showLabel && (
                        <>
                          <text x={x} y={mainY + 20} textAnchor="middle" fontSize={12} fill="#57534e">
                            {label}
                          </text>
                          {showTitle && (
                            <text x={x} y={mainY + 32} textAnchor="middle" fontSize={10} fill="#78716c">
                              {(m.prTitle ?? '').slice(0, 22) + ((m.prTitle?.length ?? 0) > 22 ? '…' : '')}
                            </text>
                          )}
                          {showDate && (
                            <text x={x} y={showTitle ? mainY + 44 : mainY + 32} textAnchor="middle" fontSize={10} fill="#78716c">
                              {fmtLabelDate(m.date)}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                });
              })()}
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
            const isDimmed = (hoveredPR !== null && !isHovered) || hoveredBranch !== null;
            const isFocusedPR = focusedErrorBranch?.name === pr.branchName;
            const opacity = isFocusedPR ? 1 : isDimmed ? 0.1 : isHovered ? 0.85 : 0.38;
            const strokeColor = isHovered ? '#44403c' : '#78716c';
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

            const prDelay = prDelayMs.get(pr.number) ?? 0;

            const mergedBranch = branches.find(b => b.name === pr.branchName);
            const focusedPRColor = mergedBranch?.status === 'conflict-risk' ? '#dc2626' : '#d97706';
            return (
              <g
                key={pr.number}
                opacity={opacity}
                style={{ cursor: mergedBranch ? 'pointer' : 'default', transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHoveredPR(pr.number)}
                onMouseLeave={() => { setHoveredPR(null); setHoveredPRCommit(null); }}
                onClick={() => { if (mergedBranch) onBranchClick?.(mergedBranch); }}
              >
                {/* Wide invisible stroke for hover */}
                <path d={arcPath} fill="none" stroke="transparent" strokeWidth={20} />
                {/* Visible arc — draws in */}
                <path
                  d={arcPath}
                  fill="none"
                  stroke={isFocusedPR ? focusedPRColor : strokeColor}
                  strokeWidth={focusedErrorBranch?.name === pr.branchName ? 2 : strokeWidth}
                  pathLength={1}
                  className="draw-path-arc"
                  style={{ pointerEvents: 'none', '--delay': `${prDelay}ms` } as React.CSSProperties}
                />

                {/* Arc info — fades in as arc draws */}
                <g className="fade-in-info" style={{ '--delay': `${prDelay + INFO_OFFSET}ms` } as React.CSSProperties}>
                  <rect x={forkX - NODE_SIZE / 2} y={mainY - NODE_SIZE / 2}
                    width={NODE_SIZE} height={NODE_SIZE} rx={2}
                    fill="#fafaf9" stroke={isFocusedPR ? focusedPRColor : strokeColor} strokeWidth={isFocusedPR ? 1.5 : 1} style={{ pointerEvents: 'none' }} />
                  <rect x={effectiveMergeX - NODE_SIZE / 2} y={mainY - NODE_SIZE / 2}
                    width={NODE_SIZE} height={NODE_SIZE} rx={2}
                    fill="#fafaf9" stroke={isFocusedPR ? focusedPRColor : strokeColor} strokeWidth={isFocusedPR ? 1.5 : 1} style={{ pointerEvents: 'none' }} />

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
                          rx={1.5}
                          fill={isFocusedPR ? focusedPRColor : isHovered ? '#a8a29e' : '#78716c'}
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
                  <text x={midX + 14} y={arcY - 18} fontSize={12} fill={isHovered ? '#1c1917' : '#57534e'}>
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
              const isInactiveError = inactiveErrorSet.has(b.name);
              const hasOpenPR = openPRBranchNames.has(b.name);
              const daysSinceCommit = (Date.now() - new Date(b.lastCommitDate).getTime()) / 86400000;
              const showClockIcon = hasOpenPR && daysSinceCommit >= 60;

              const isFocusedError = focusedErrorBranch?.name === b.name;
              const focusedErrorColor = b.status === 'conflict-risk' ? '#dc2626' : '#d97706';
              const color = isFocusedError
                ? focusedErrorColor
                : isSelected
                ? '#22d3ee'
                : isInactiveError
                ? '#78716c'
                : isConflict
                ? '#dc2626'
                : isStale
                ? '#d97706'
                : hasSelection
                ? '#57534e'
                : '#78716c';
              const strokeWidth = isSelected ? 2.5 : isHovered ? 2 : isFocusedError ? 2 : 1.5;
              const strokeColor = isHovered && !isSelected ? '#44403c' : color;

              const TRAIL = 80;
              const lastCommitX = timeToX(b.lastCommitDate);
              const tipX = Math.max(lastCommitX, forkX + CORNER_R + 20);
              const curvePath = `M ${forkX} ${mainY} L ${forkX} ${y + CORNER_R} Q ${forkX} ${y} ${forkX + CORNER_R} ${y} L ${tipX} ${y}`;

              const commitCount = Math.min(b.commitsAhead, 4);
              const spanWidth = tipX - (forkX + CORNER_R);
              const commitXs = Array.from({ length: commitCount }, (_, i) =>
                forkX + CORNER_R + (spanWidth * (i + 1)) / (commitCount + 1)
              );

              const brDelay = branchDelayMs.get(b.name) ?? 0;

              // If this branch forks directly on a merge node, suppress the fork
              // labels below the main line — the branch is identified by its arc
              // label, and stacking more text under the PR node is confusing.
              const forkOnNode = sortedNodes.some(n =>
                Math.abs((nodeXByFullSha.get(n.fullSha) ?? timeToX(n.date)) - forkX) < NODE_SIZE
              );
              const forkLabelY  = mainY + 20;
              const statusLabelY = mainY + 34;

              return (
                <g
                  key={b.name}
                  className="cursor-pointer"
                  onClick={() => onBranchSelect?.(b)}
                  onDoubleClick={() => onBranchClick?.(b)}
                  style={{ opacity: isFocusedError ? 1 : hoveredBranch !== null && !isHovered ? 0.12 : isInactiveError ? 0.45 : hasSelection && !isSelected ? 0.5 : 1, transition: 'opacity 0.15s' }}
                >
                  {/* Glow effect for selected branch — keyed so it never displaces the arc path */}
                  {isSelected && (
                    <path
                      key="glow"
                      d={curvePath}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth={8}
                      strokeOpacity={0.25}
                      style={{ filter: 'blur(4px)' }}
                    />
                  )}
                  {/* Branch path — draws in. key="arc" keeps the DOM node stable so the
                      CSS animation is never restarted when sibling elements change. */}
                  <path
                    key="arc"
                    d={curvePath}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    pathLength={1}
                    className="draw-path-arc"
                    style={{ '--delay': `${brDelay}ms`, transition: 'stroke 0.12s ease, stroke-width 0.12s ease' } as React.CSSProperties}
                  />

                  {/* Branch info — fades in as arc draws */}
                  <g className="fade-in-info" style={{ '--delay': `${brDelay + INFO_OFFSET}ms` } as React.CSSProperties}>
                    {/* Dashed trailing edge */}
                    <line
                      x1={tipX}
                      y1={y}
                      x2={tipX + TRAIL}
                      y2={y}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray="6 5"
                      style={{ transition: 'stroke 0.12s ease, stroke-width 0.12s ease' }}
                    />

                    {/* Fork hollow square on main */}
                    <rect
                      x={forkX - NODE_SIZE / 2}
                      y={mainY - NODE_SIZE / 2}
                      width={NODE_SIZE}
                      height={NODE_SIZE}
                      rx={2}
                      fill={isSelected ? '#22d3ee' : isFocusedError ? color : '#1c1917'}
                      stroke={color}
                      strokeWidth={strokeWidth}
                    />
                    {/* Branch name label below main line — hidden when fork sits on a merge node */}
                    {!forkOnNode && (
                      <text x={forkX} y={forkLabelY} textAnchor="middle" fontSize={10} fill="#78716c">
                        {b.name.length > 18 ? b.name.slice(0, 18) + '…' : b.name}
                      </text>
                    )}

                    {/* Commit filled squares along branch */}
                    {commitXs.map((cx, ci) => (
                      <rect
                        key={ci}
                        x={cx - NODE_SIZE / 2}
                        y={y - NODE_SIZE / 2}
                        width={NODE_SIZE}
                        height={NODE_SIZE}
                        rx={2}
                        fill={color}
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

                    {/* Author initial circle — inset 8px from start of horizontal arc */}
                    <circle cx={forkX + CORNER_R + 8} cy={y - 26} r={9} fill={isSelected ? '#0891b2' : '#57534e'} />
                    <text
                      x={forkX + CORNER_R + 8}
                      y={y - 22}
                      textAnchor="middle"
                      fontSize={10}
                      fill={isSelected ? '#ecfeff' : '#ffffff'}
                      fontWeight={500}
                    >
                      {b.lastCommitAuthor?.charAt(0).toUpperCase() || '?'}
                    </text>

                    {/* Branch name label */}
                    <text
                      x={forkX + CORNER_R + 24}
                      y={y - 22}
                      fontSize={12}
                      fontWeight={isSelected ? 600 : 400}
                      fill={isSelected ? '#22d3ee' : isHovered ? '#1c1917' : color}
                      style={{ transition: 'fill 0.12s ease' }}
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

                    {/* Clock icon for open PR + 60+ day stale commit */}
                    {showClockIcon && (() => {
                      const nameLen = Math.min(b.name.length, 22);
                      const approxNameW = nameLen * 6.5;
                      const cx = forkX + CORNER_R + 24 + approxNameW + 10;
                      const cy = y - 22;
                      return (
                        <g transform={`translate(${cx}, ${cy})`} style={{ pointerEvents: 'none' }}>
                          <circle r={5} fill="none" stroke={color} strokeWidth={1.2} />
                          <line x1={0} y1={-3} x2={0} y2={0} stroke={color} strokeWidth={1.2} strokeLinecap="round" />
                          <line x1={0} y1={0} x2={2.5} y2={1.5} stroke={color} strokeWidth={1.2} strokeLinecap="round" />
                        </g>
                      );
                    })()}
                  </g>

                  {/* Status labels — own fade-in-pill group so they animate independently of fade-in-info */}
                  {!forkOnNode && !isInactiveError && (isStale || isConflict) && (
                    <g
                      className="fade-in-pill"
                      style={{ '--delay': `${brDelay + INFO_OFFSET}ms`, cursor: 'pointer' } as React.CSSProperties}
                      onClick={() => onBranchClick?.(b)}
                    >
                      {/* Invisible hit area — text alone is too small to click reliably */}
                      <rect
                        x={forkX - 22}
                        y={statusLabelY - 11}
                        width={44}
                        height={14}
                        fill="transparent"
                      />
                      {isStale && (
                        <text x={forkX} y={statusLabelY} textAnchor="middle" fontSize={10} fill="#d97706">stale</text>
                      )}
                      {isConflict && (
                        <text x={forkX} y={statusLabelY} textAnchor="middle" fontSize={10} fill="#dc2626">conflict</text>
                      )}
                    </g>
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
                height={62}
                rx={8}
                fill="#ffffff"
                stroke="#e7e5e0"
                strokeWidth={1}
                filter="url(#tick-shadow)"
              />
              {tooltip.lines.map((line, i) => (
                <text
                  key={i}
                  x={tooltip.x + 4}
                  y={tooltip.y - 33 + i * 16}
                  fontSize={10}
                  fill={i === 0 ? '#dc2626' : '#78716c'}
                >
                  {line}
                </text>
              ))}
            </g>
          )}

          {/* Tooltip for main-line merge nodes — shown above the tick */}
          {hoveredMergeNode && (() => {
            const { x, node: m } = hoveredMergeNode;
            const label = m.prNumber ? `PR #${m.prNumber}` : m.sha.slice(0, 7);
            const title = m.prTitle ?? '';
            const hasTitle = title.length > 0;
            const TW = 220;
            const TH = hasTitle ? 44 : 30;
            const tx = x - TW / 2;
            const ty = mainY - TH - 14;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect x={tx} y={ty} width={TW} height={TH} rx={8}
                  fill="#ffffff" stroke="#e7e5e0" strokeWidth={1}
                  filter="url(#tick-shadow)" />
                <text x={tx + 10} y={ty + 14} fontSize={10} fontWeight={600} fill="#1c1917">
                  {label}{hasTitle ? ` · ${title.slice(0, 30)}${title.length > 30 ? '…' : ''}` : ''}
                </text>
                {hasTitle && (
                  <text x={tx + 10} y={ty + 30} fontSize={10} fill="#a8a29e">
                    {fmtLabelDate(m.date)}
                  </text>
                )}
              </g>
            );
          })()}

          {/* Tooltip for PR commit SHAs — positioned below the tick */}
          {hoveredPRCommit && (() => {
            const { x, arcY, pr, commitIdx } = hoveredPRCommit;
            const sha = prCommits.get(pr.number)?.[commitIdx];
            const TW = 200;
            const tx = x - TW / 2;
            const ty = arcY + 14;
            return (
              <g style={{ pointerEvents: 'none' }}>
                <rect x={tx} y={ty} width={TW} height={60} rx={8}
                  fill="#ffffff" stroke="#e7e5e0" strokeWidth={1}
                  filter="url(#tick-shadow)" />
                <text x={tx + 10} y={ty + 17} fontSize={10} fontWeight={600} fill="#1c1917">
                  {sha ?? `commit ${commitIdx + 1}`}
                </text>
                <text x={tx + 10} y={ty + 32} fontSize={10} fill="#78716c">
                  PR #{pr.number} · {pr.branchName.length > 22 ? pr.branchName.slice(0, 22) + '…' : pr.branchName}
                </text>
                <text x={tx + 10} y={ty + 47} fontSize={10} fill="#a8a29e">
                  @{pr.authorLogin} · merged {fmtLabelDate(pr.mergedAt)}
                </text>
              </g>
            );
          })()}
        </svg>

        {/* Empty / loading state */}
        {sortedNodes.length === 0 && activeBranches.length === 0 && (
          isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              No branches or merge commits found
            </div>
          )
        )}
      </div>

      {/* Bottom chrome: scrollbar + zoom — absolute so it stays inside the map
          container and respects visibility:hidden when the diff view is shown. */}
      <div className="absolute bottom-6 left-6 right-6 flex flex-col gap-2 z-50">

        {/* Scrollbar + zoom row */}
        <div
          className="flex items-center gap-4"
          style={{
            opacity: isLoading || !scrollbarReady ? 0 : 1,
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
