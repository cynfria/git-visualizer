'use client';

import { useRouter } from 'next/navigation';
import { Branch, MergeNode } from '@/types';
import { useState, useRef } from 'react';

const MAIN_Y = 720;
const BRANCH_SPACING = 90; // vertical gap between branch lanes
const COMMIT_SPACING = 180; // horizontal px per "slot"
const NODE_SIZE = 8;
const CORNER_R = 24;
const LEFT_PAD = 80;

type TooltipData = {
  x: number;
  y: number;
  text: string[];
};

type HoverBranch = {
  x: number;
  y: number;
  name: string;
};

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtDateShort(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function BranchMap({
  branches,
  mergeNodes,
  owner,
  repo,
  defaultBranch,
}: {
  branches: Branch[];
  mergeNodes: MergeNode[];
  owner: string;
  repo: string;
  defaultBranch: string;
}) {
  const router = useRouter();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const [hoverBranch, setHoverBranch] = useState<HoverBranch | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const activeBranches = branches.filter(
    (b) => b.name !== defaultBranch && b.commitsAhead > 0
  );
  const mergedBranches = branches.filter(
    (b) => b.name !== defaultBranch && b.commitsAhead === 0
  );

  // X position for each merge node slot (left to right = oldest to newest)
  const mergeXMap = new Map<string, number>();
  const sortedMerge = [...mergeNodes].reverse(); // oldest first
  sortedMerge.forEach((m, i) => {
    mergeXMap.set(m.sha, LEFT_PAD + i * COMMIT_SPACING);
  });

  const mainEndX = LEFT_PAD + Math.max(sortedMerge.length, 1) * COMMIT_SPACING;
  const svgWidth = mainEndX + 300;

  // Assign a lane (Y offset above main) for each active branch
  const laneY = (idx: number) => MAIN_Y - BRANCH_SPACING * (idx + 1) - 60;

  // Determine x where a branch diverged (approx: use last merge node before branch's last commit)
  function branchDivergeX(b: Branch): number {
    if (!b.divergedFromSha) return mainEndX - COMMIT_SPACING;
    const exact = mergeXMap.get(b.divergedFromSha.slice(0, 7));
    if (exact) return exact;
    // fallback: place near end
    return mainEndX;
  }

  const svgHeight = MAIN_Y + 140;

  return (
    <div className="relative w-full overflow-x-auto">
      <svg
        ref={svgRef}
        width={svgWidth}
        height={svgHeight}
        className="select-none"
        style={{ minWidth: '100%' }}
      >
        {/* ── Main line ── */}
        {/* Solid portion */}
        <line
          x1={LEFT_PAD}
          y1={MAIN_Y}
          x2={mainEndX}
          y2={MAIN_Y}
          stroke="#1a1a1a"
          strokeWidth={1.5}
        />
        {/* Dashed trailing edge */}
        <line
          x1={mainEndX}
          y1={MAIN_Y}
          x2={mainEndX + 120}
          y2={MAIN_Y}
          stroke="#1a1a1a"
          strokeWidth={1.5}
          strokeDasharray="6 5"
        />

        {/* ── Merge nodes on main ── */}
        {sortedMerge.map((m) => {
          const x = mergeXMap.get(m.sha) ?? 0;
          return (
            <g key={m.sha}>
              <rect
                x={x - NODE_SIZE / 2}
                y={MAIN_Y - NODE_SIZE / 2}
                width={NODE_SIZE}
                height={NODE_SIZE}
                fill="white"
                stroke="#1a1a1a"
                strokeWidth={1.5}
              />
              {/* Label below */}
              <text x={x} y={MAIN_Y + 22} textAnchor="middle" fontSize={11} fill="#6b7280">
                {m.prNumber ? `PR #${m.prNumber}` : m.sha}
              </text>
              <text x={x} y={MAIN_Y + 35} textAnchor="middle" fontSize={10} fill="#9ca3af" className="max-w-[120px]">
                {m.prTitle ? m.prTitle.slice(0, 20) + (m.prTitle.length > 20 ? '…' : '') : ''}
              </text>
              <text x={x} y={MAIN_Y + 47} textAnchor="middle" fontSize={9} fill="#9ca3af">
                {fmtDateShort(m.date)}
              </text>
            </g>
          );
        })}

        {/* Main label */}
        <text
          x={mainEndX + 130}
          y={MAIN_Y + 4}
          fontSize={12}
          fill="#1a1a1a"
          fontWeight={500}
        >
          Main
        </text>

        {/* ── Active branches ── */}
        {activeBranches.map((b, idx) => {
          const y = laneY(idx);
          const startX = branchDivergeX(b);
          const isError = b.status === 'conflict-risk';
          const color = isError ? '#dc2626' : '#6b7280';
          const commitCount = Math.min(b.commitsAhead, 4);
          const branchEndX = mainEndX + 80;

          // Smooth corner path: go from (startX, MAIN_Y) up to (startX + CORNER_R, y) with arc
          const curvePath = `M ${startX} ${MAIN_Y} L ${startX} ${y + CORNER_R} Q ${startX} ${y} ${startX + CORNER_R} ${y} L ${branchEndX} ${y}`;

          // Commit node positions along branch
          const commitXs = Array.from({ length: commitCount }, (_, i) =>
            startX + CORNER_R + 40 + i * 50
          );

          return (
            <g key={b.name}>
              {/* Branch curve path */}
              <path
                d={curvePath}
                fill="none"
                stroke={color}
                strokeWidth={1.5}
              />
              {/* Dashed trailing edge */}
              <line
                x1={branchEndX}
                y1={y}
                x2={branchEndX + 60}
                y2={y}
                stroke={color}
                strokeWidth={1.5}
                strokeDasharray="6 5"
              />

              {/* Fork point (hollow square on main line) */}
              <rect
                x={startX - NODE_SIZE / 2}
                y={MAIN_Y - NODE_SIZE / 2}
                width={NODE_SIZE}
                height={NODE_SIZE}
                fill="white"
                stroke={color}
                strokeWidth={1.5}
              />

              {/* Commit nodes along branch */}
              {commitXs.map((cx, ci) => (
                <rect
                  key={ci}
                  x={cx - NODE_SIZE / 2}
                  y={y - NODE_SIZE / 2}
                  width={NODE_SIZE}
                  height={NODE_SIZE}
                  fill={isError ? '#dc2626' : '#6b7280'}
                  stroke="none"
                  className="cursor-pointer"
                  onMouseEnter={(e) => {
                    const rect = svgRef.current?.getBoundingClientRect();
                    setTooltip({
                      x: cx,
                      y: y - 20,
                      text: [
                        `Commit ${b.headSha?.slice(0, 7) ?? '-------'}`,
                        `@${b.lastCommitAuthor}`,
                        fmtDate(b.lastCommitDate),
                      ],
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              ))}

              {/* Author avatar circle */}
              {b.lastCommitAuthorAvatar ? (
                <image
                  href={b.lastCommitAuthorAvatar}
                  x={startX - 10}
                  y={y - 40}
                  width={20}
                  height={20}
                  clipPath={`circle(10px at 10px 10px)`}
                  className="rounded-full"
                />
              ) : (
                <circle cx={startX} cy={y - 30} r={10} fill="#d1d5db" />
              )}

              {/* Branch name label */}
              <text
                x={startX + 16}
                y={y - 24}
                fontSize={12}
                fill={color}
                className="cursor-pointer"
                onMouseEnter={() =>
                  setHoverBranch({ x: startX + 16, y: y - 24, name: b.name })
                }
                onMouseLeave={() => setHoverBranch(null)}
                onClick={() =>
                  router.push(`/repo/${owner}/${repo}/diff/${encodeURIComponent(b.name)}`)
                }
              >
                {b.name.length > 20 ? b.name.slice(0, 20) + '…' : b.name}
              </text>

              {/* Status icons below main at fork X */}
              {b.status === 'stale' && (
                <g>
                  <title>Out of date</title>
                  <text x={startX - 8} y={MAIN_Y + 65} fontSize={14}>📅</text>
                </g>
              )}
              {b.status === 'conflict-risk' && (
                <g>
                  <title>Merge conflict risk</title>
                  <text x={startX - 8} y={MAIN_Y + 65} fontSize={14}>⚠</text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Merged (inactive) branches — ghosted cards ── */}
        {mergedBranches.slice(0, 3).map((b, idx) => {
          const cardX = LEFT_PAD + idx * (COMMIT_SPACING + 20);
          const cardY = MAIN_Y - 260;
          const cardW = 160;
          const cardH = 90;

          return (
            <g key={b.name} opacity={0.4}>
              <rect
                x={cardX}
                y={cardY}
                width={cardW}
                height={cardH}
                rx={12}
                fill="none"
                stroke="#9ca3af"
                strokeWidth={1}
              />
              {/* Line from card bottom to main */}
              <line
                x1={cardX + cardW / 2}
                y1={cardY + cardH}
                x2={cardX + cardW / 2}
                y2={MAIN_Y}
                stroke="#9ca3af"
                strokeWidth={1}
              />
              <circle cx={cardX + 18} cy={cardY + 22} r={8} fill="#d1d5db" />
              <text x={cardX + 32} y={cardY + 27} fontSize={11} fill="#6b7280">
                {b.name.length > 14 ? b.name.slice(0, 14) + '…' : b.name}
              </text>
              {/* Small commit dots */}
              {[0, 1, 2].map((i) => (
                <rect
                  key={i}
                  x={cardX + 16 + i * 30}
                  y={cardY + 48 - NODE_SIZE / 2}
                  width={NODE_SIZE}
                  height={NODE_SIZE}
                  fill="#9ca3af"
                />
              ))}
              {/* Dashed line inside card */}
              <line
                x1={cardX + 16}
                y1={cardY + 48}
                x2={cardX + cardW - 16}
                y2={cardY + 48}
                stroke="#9ca3af"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            </g>
          );
        })}

        {/* ── Commit tooltip ── */}
        {tooltip && (
          <g>
            <rect
              x={tooltip.x - 8}
              y={tooltip.y - 52}
              width={200}
              height={58}
              rx={4}
              fill="white"
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            {tooltip.text.map((line, i) => (
              <text
                key={i}
                x={tooltip.x}
                y={tooltip.y - 34 + i * 16}
                fontSize={11}
                fontFamily="monospace"
                fill={i === 0 ? '#dc2626' : '#6b7280'}
              >
                {line}
              </text>
            ))}
          </g>
        )}

        {/* ── Branch hover label ── */}
        {hoverBranch && (
          <g>
            <rect
              x={hoverBranch.x - 4}
              y={hoverBranch.y - 16}
              width={hoverBranch.name.length * 7 + 16}
              height={20}
              rx={3}
              fill="white"
              stroke="#e5e7eb"
              strokeWidth={1}
            />
            <text x={hoverBranch.x + 4} y={hoverBranch.y - 2} fontSize={12} fill="#374151">
              {hoverBranch.name}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
