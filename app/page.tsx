'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
  } catch {
    const match = url.trim().match(/^([^/\s]+)\/([^/\s]+)$/);
    if (match) return { owner: match[1], repo: match[2] };
    return null;
  }
}

export default function LandingPage() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState('');
  const [showInput, setShowInput] = useState(false);
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseGitHubUrl(inputValue);
    if (!parsed) {
      setError('Paste a valid GitHub repo URL (e.g. https://github.com/owner/repo)');
      return;
    }
    setError('');
    router.push(`/repo/${parsed.owner}/${parsed.repo}`);
  }

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Left decorative panel */}
      <div className="w-[42%] relative flex-shrink-0 bg-muted overflow-hidden">
        <DotCircle size={320} left="38%" top="34%" />
        <DotCircle size={280} left="52%" top="68%" />
        <div
          className="absolute text-[9px] text-muted-foreground tracking-widest font-mono leading-4"
          style={{ top: '44%', left: '58%', transform: 'rotate(90deg)', transformOrigin: 'left top' }}
        >
          59.9139°N<br />10.7522°E
        </div>
      </div>

      {/* Right content panel */}
      <div className="flex-1 flex flex-col justify-center px-16 bg-card">
        <p className="text-[10px] text-muted-foreground mb-3 tracking-widest uppercase font-medium">
          Git visualizer
        </p>
        <h1 className="text-[2.4rem] font-semibold leading-[1.15] text-foreground mb-12 max-w-xs">
          See what your team is building.
        </h1>

        <p className="text-[10px] text-muted-foreground mb-4 uppercase tracking-widest font-medium">
          Get started
        </p>

        <div className="flex flex-col gap-2.5 w-60">
          <button
            onClick={() => signIn('github')}
            className="px-5 py-2.5 rounded-lg border border-border text-foreground text-sm hover:bg-accent transition-colors text-center"
          >
            Connect GitHub
          </button>

          {!showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity text-center"
            >
              Enter repo URL
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <input
                autoFocus
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setError(''); }}
                placeholder="https://github.com/owner/repo"
                className="px-4 py-2.5 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary transition-colors"
              />
              {error && <p className="text-xs text-destructive">{error}</p>}
              <button
                type="submit"
                className="px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm hover:opacity-90 transition-opacity"
              >
                View branches →
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

function DotCircle({ size, left, top }: { size: number; left: string; top: string }) {
  const r = size / 2;
  const spacing = 9;
  const dots: { x: number; y: number; opacity: number }[] = [];

  for (let x = -r; x <= r; x += spacing) {
    for (let y = -r; y <= r; y += spacing) {
      const dist = Math.sqrt(x * x + y * y);
      if (dist <= r) {
        dots.push({ x, y, opacity: 1 - (dist / r) * 0.75 });
      }
    }
  }

  return (
    <div className="absolute" style={{ left, top, transform: 'translate(-50%, -50%)' }}>
      <svg width={size} height={size} viewBox={`${-r} ${-r} ${size} ${size}`}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={1.3} fill="currentColor"
            className="text-muted-foreground" opacity={d.opacity * 0.45} />
        ))}
      </svg>
    </div>
  );
}
