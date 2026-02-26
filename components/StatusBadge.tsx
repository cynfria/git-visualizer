import { BranchStatus } from '../types';

const config: Record<BranchStatus, { label: string; className: string }> = {
  fresh: {
    label: 'Fresh',
    className: 'bg-emerald-950/50 text-emerald-400 border border-emerald-800',
  },
  stale: {
    label: 'Stale',
    className: 'bg-amber-950/50 text-amber-400 border border-amber-800',
  },
  'conflict-risk': {
    label: 'Conflict Risk',
    className: 'bg-red-950/50 text-red-400 border border-red-800',
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-stone-800 text-stone-400 border border-stone-700',
  },
};

export default function StatusBadge({ status }: { status: BranchStatus }) {
  const { label, className } = config[status];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}
