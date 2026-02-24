import { BranchStatus } from '@/types';

const config: Record<BranchStatus, { label: string; className: string }> = {
  fresh: {
    label: 'Fresh',
    className: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  stale: {
    label: 'Stale',
    className: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
  'conflict-risk': {
    label: 'Conflict Risk',
    className: 'bg-red-50 text-red-600 border border-red-200',
  },
  unknown: {
    label: 'Unknown',
    className: 'bg-stone-100 text-stone-500 border border-stone-200',
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
