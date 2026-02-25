import { Branch, MergeNode } from '../types';
import { useState, useRef, useEffect } from 'react';

// ── Layout constants ──────────────────────────────────────────────────────────
const MAIN_Y = 420;
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
  defaultBranch: string;
  selectedBranch?: Branch | null;
  onBranchSelect?: (branch: Branch) => void;
  onBranchClick?: (branch: Branch) => void;
  onLoadMore?: () => void;
}

export default function BranchMap({
  branches,
  mergeNodes,
  defaultBranch,
  selectedBranch,
  onBranchSelect,
  onBranchClick,
}: BranchMapProps) {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoveredBranch, setHoveredBranch] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomScrollAnchor = useRef<{
    contentX: number;
    mouseX: number;
    oldZoom: number;
  } | null>(null);

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

  // ── Separate active branches ──────────────────────────────────────
  const activeBranches = branches
    .filter((b) => b.name !== defaultBranch && b.commitsAhead > 0)
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
  const svgWidth = mainEndX + RIGHT_PAD + 80;

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

  function laneY(b: Branch): number {
    const lane = laneAssignments.get(b.name) ?? 0;
    return MAIN_Y - LANE_HEIGHT * (lane + 1) - 40;
  }

  const svgHeight = MAIN_Y + 120;

  return (
    <div className="relative h-full">
      <div
        ref={scrollRef}
        className="w-full h-full overflow-x-auto branch-map-scroll"
      >
        <svg
          width={svgWidth}
          height={svgHeight}
          style={{ minWidth: svgWidth, display: 'block' }}
        >
          {/* ── Main timeline + merge nodes ── */}
          <g>
            <line
              x1={LEFT_PAD}
              y1={MAIN_Y}
              x2={mainEndX}
              y2={MAIN_Y}
              stroke="#a8a29e"
              strokeWidth={1.5}
            />
            <line
              x1={mainEndX}
              y1={MAIN_Y}
              x2={mainEndX + 80}
              y2={MAIN_Y}
              stroke="#a8a29e"
              strokeWidth={1.5}
              strokeDasharray="6 5"
            />
            <text
              x={mainEndX + 90}
              y={MAIN_Y + 4}
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
                    y={MAIN_Y - NODE_SIZE / 2}
                    width={NODE_SIZE}
                    height={NODE_SIZE}
                    fill="#1c1917"
                    stroke="#a8a29e"
                    strokeWidth={1.5}
                  />
                  <text
                    x={x}
                    y={MAIN_Y + 20}
                    textAnchor="middle"
                    fontSize={11}
                    fill="#a8a29e"
                  >
                    {label}
                  </text>
                  <text
                    x={x}
                    y={MAIN_Y + 32}
                    textAnchor="middle"
                    fontSize={10}
                    fill="#78716c"
                  >
                    {title}
                  </text>
                  <text
                    x={x}
                    y={MAIN_Y + 44}
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

          {/* ── Active branches ── */}
          <g>
            {activeBranches.map((b) => {
              const forkX = branchForkX(b);
              const y = laneY(b);
              const isError = b.status === 'conflict-risk';
              const isSelected = selectedBranch?.name === b.name;
              const isHovered = hoveredBranch === b.name;
              const hasSelection = selectedBranch != null;

              // Color logic: selected = bright cyan, error = red, default = stone
              const color = isSelected
                ? '#22d3ee' // cyan-400
                : isError
                ? '#ef4444'
                : hasSelection
                ? '#57534e' // dimmed when another branch is selected
                : '#a8a29e';
              const strokeWidth = isSelected ? 2.5 : 1.5;

              const TRAIL = 80;

              const lastCommitX = timeToX(b.lastCommitDate);
              const tipX = Math.max(lastCommitX, forkX + CORNER_R + 20);

              const curvePath = `M ${forkX} ${MAIN_Y} L ${forkX} ${y + CORNER_R} Q ${forkX} ${y} ${forkX + CORNER_R} ${y} L ${tipX} ${y}`;

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
                    y={MAIN_Y - NODE_SIZE / 2}
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
                      <text x={forkX - 8} y={MAIN_Y + 62} fontSize={13}>
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
                        y={MAIN_Y + 62}
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
          <div className="absolute inset-0 flex items-center justify-center text-stone-500">
            No branches or merge commits found
          </div>
        )}
      </div>

      {/* Zoom controls */}
      <div className="absolute bottom-4 right-4 flex items-center gap-1 bg-stone-800 border border-stone-700 rounded-lg shadow-sm px-2 py-1.5">
        <button
          onClick={() =>
            setZoom((z) =>
              Math.max(ZOOM_MIN, Math.round((z - 0.25) * 100) / 100)
            )
          }
          className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-100 hover:bg-stone-700 rounded transition-colors text-base leading-none"
          title="Zoom out"
        >
          −
        </button>
        <span className="text-xs text-stone-400 w-12 text-center tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() =>
            setZoom((z) =>
              Math.min(ZOOM_MAX, Math.round((z + 0.25) * 100) / 100)
            )
          }
          className="w-6 h-6 flex items-center justify-center text-stone-400 hover:text-stone-100 hover:bg-stone-700 rounded transition-colors text-base leading-none"
          title="Zoom in"
        >
          +
        </button>
      </div>
    </div>
  );
}
