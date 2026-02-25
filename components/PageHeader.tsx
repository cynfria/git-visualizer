import { ReactNode } from 'react';

export function PageHeader({
  left,
  center,
  right,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="grid grid-cols-[1fr_auto_1fr] items-center px-8 py-4 border-b border-border/50 shrink-0">
      <div className="flex items-center">{left}</div>
      <div className="flex items-center justify-center">{center}</div>
      <div className="flex items-center justify-end gap-2">{right}</div>
    </header>
  );
}
