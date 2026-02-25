import { Branch, MergeNode, MergedPR } from '../types';
import { useState, useRef, useEffect } from 'react';

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
const MERGED_LANE_HEIGHT = 60;
const MERGED_LANES = 4;

type TooltipData = { x: number; y: number; lines: string[] };

function fmtTooltipDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtLabelDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
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
}

export default function BranchMap({
  branches,
  mergeNodes,
  mergedPRs = [],
  defaultBranch,
  selectedBranch,
  onBranchSelect,
  onBranchClick,
}: BranchMapProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const [hoveredPR, setHoveredPR] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
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

  // ── Separate active vs merged branches ──────────────────────────────────────
  const mergedBranchNames = new Set(mergedPRs.map(pr => pr.branchName));
  const activeBranches = branches
    .filter((b) => b.name !== defaultBranch && b.commitsAhead > 0 && !mergedBranchNames.has(b.name))
    .sort(
      (a, b) =>
        new Date(b.lastCommitDate).getTime() -
        new Date(a.lastCommitDate).getTime()
    )
    .slice(0, MAX_ACTIVE);

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
  const svgHeight = Math.max(mainY + 120, containerHeight);

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="w-full h-full overflow-x-auto overflow-y-hidden branch-map-scroll"
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          style={{ minWidth: svgWidth, display: 'block' }}
        >
          {/* ── Main timeline + merge nodes ── */}
          <g style={{ opacity: hoveredPR !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
            <line
              x1={LEFT_PAD}
              y1={mainY}
              x2={mainEndX}
              y2={mainY}
              stroke="#a8a29e"
              strokeWidth={1.5}
            />
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

          {/* ── Merged PRs — interactive arcs ── */}
          {mergedPRs.map((pr, idx) => {
            const forkX = timeToX(pr.createdAt);
            const mergeX = timeToX(pr.mergedAt);
            const lane = idx % MERGED_LANES;
            const arcY = mainY - MERGED_LANE_HEIGHT * (lane + 1);
            const commitCount = Math.min(pr.commitCount ?? 1, 12);
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

            return (
              <g
                key={pr.number}
                opacity={opacity}
                style={{ cursor: 'pointer', transition: 'opacity 0.15s' }}
                onMouseEnter={() => setHoveredPR(pr.number)}
                onMouseLeave={() => setHoveredPR(null)}
              >
                {/* Wide invisible stroke for hover */}
                <path d={arcPath} fill="none" stroke="transparent" strokeWidth={20} />
                {/* Visible arc */}
                <path d={arcPath} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} style={{ pointerEvents: 'none' }} />

                <rect x={forkX - NODE_SIZE / 2} y={mainY - NODE_SIZE / 2}
                  width={NODE_SIZE} height={NODE_SIZE}
                  fill="#1c1917" stroke={strokeColor} strokeWidth={1} style={{ pointerEvents: 'none' }} />
                <rect x={effectiveMergeX - NODE_SIZE / 2} y={mainY - NODE_SIZE / 2}
                  width={NODE_SIZE} height={NODE_SIZE}
                  fill="#1c1917" stroke={strokeColor} strokeWidth={1} style={{ pointerEvents: 'none' }} />

                {/* Commit ticks */}
                {commitXs.map((cx, ci) => (
                  <rect
                    key={ci}
                    x={cx - (NODE_SIZE - 2) / 2}
                    y={arcY - (NODE_SIZE - 2) / 2}
                    width={NODE_SIZE - 2}
                    height={NODE_SIZE - 2}
                    fill={isHovered ? '#a8a29e' : '#78716c'}
                    style={{ pointerEvents: 'none' }}
                  />
                ))}

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
            );
          })}

          {/* ── Active branches ── */}
          <g style={{ opacity: hoveredPR !== null ? 0.2 : 1, transition: 'opacity 0.15s' }}>
            {activeBranches.map((b) => {
              const forkX = branchForkX(b);
              const y = laneY(b);
              const isError = b.status === 'conflict-risk';
              const isSelected = selectedBranch?.name === b.name;
              const isHovered = hoveredBranch === b.name;
              const hasSelection = selectedBranch != null;

              const color = isSelected
                ? '#22d3ee'
                : isError
                ? '#ef4444'
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
                  {/* Branch path */}
                  <path
                    d={curvePath}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                  />
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

                  {/* Commit filled squares along branch */}
                  {commitXs.map((cx, ci) => (
                    <rect
                      key={ci}
                      x={cx - NODE_SIZE / 2}
                      y={y - NODE_SIZE / 2}
                      width={NODE_SIZE}
                      height={NODE_SIZE}
                      fill={isSelected ? '#22d3ee' : isError ? '#ef4444' : '#78716c'}
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

                  {/* Status icons below main line */}
                  {b.status === 'stale' && (
                    <g>
                      <title>Out of date — no commits in 14+ days</title>
                      <text x={forkX - 8} y={mainY + 62} fontSize={13}>
                        📅
                      </text>
                    </g>
                  )}
                  {b.status === 'conflict-risk' && (
                    <g>
                      <title>
                        Conflict risk — branch is significantly behind
                      </title>
                      <text
                        x={forkX - 8}
                        y={mainY + 62}
                        fontSize={13}
                        fill="#ef4444"
                      >
                        ⚠
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </g>

          {/* Tooltip */}
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
        </svg>

        {/* Empty state */}
        {sortedNodes.length === 0 && activeBranches.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            No branches or merge commits found
          </div>
        )}
      </div>

      {/* Bottom chrome: scrollbar + zoom controls */}
      <div className="absolute bottom-4 left-4 right-4 flex items-center gap-4">
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
        <div className="flex items-center gap-1 bg-card border border-border rounded-lg shadow-sm px-2 py-1.5">
          <button
            onClick={() =>
              setZoom((z) =>
                Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100)
              )
            }
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors text-base leading-none"
            title="Zoom out"
          >
            −
          </button>
          <span className="text-xs text-muted-foreground w-12 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() =>
              setZoom((z) =>
                Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100)
              )
            }
            className="w-6 h-6 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors text-base leading-none"
            title="Zoom in"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
