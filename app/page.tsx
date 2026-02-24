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
    <main className="flex h-screen overflow-hidden bg-[#F5F5F3]">
      {/* Left decorative panel */}
      <div className="w-[42%] relative flex-shrink-0 bg-[#EBEBEA] overflow-hidden">
        <DotCircle size={320} left="38%" top="34%" />
        <DotCircle size={280} left="52%" top="68%" />
        <div
          className="absolute text-[9px] text-stone-400 tracking-widest font-mono leading-4"
          style={{ top: '44%', left: '58%', transform: 'rotate(90deg)', transformOrigin: 'left top' }}
        >
          59.9139°N<br />10.7522°E
        </div>
      </div>

      {/* Right content panel */}
      <div className="flex-1 flex flex-col justify-center px-16 bg-white">
        <p className="text-sm text-stone-400 mb-3 tracking-wide">Git visualizer</p>
        <h1 className="text-[2.5rem] font-bold leading-[1.15] text-stone-900 mb-14 max-w-xs">
          See what your team is building, without reading a line of code.
        </h1>

        <p className="text-sm text-stone-500 mb-4">Get started</p>

        <div className="flex flex-col gap-3 w-64">
          <button
            onClick={() => signIn('github')}
            className="px-6 py-3 border border-stone-900 text-stone-900 text-sm hover:bg-stone-900 hover:text-white transition-colors text-center"
          >
            Connect Github
          </button>

          {!showInput ? (
            <button
              onClick={() => setShowInput(true)}
              className="px-6 py-3 border border-stone-900 text-stone-900 text-sm hover:bg-stone-900 hover:text-white transition-colors text-center"
            >
              Enter Github repo link
            </button>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-2">
              <input
                autoFocus
                type="text"
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setError(''); }}
                placeholder="https://github.com/owner/repo"
                className="px-4 py-3 border border-stone-900 text-sm text-stone-900 placeholder-stone-400 outline-none focus:ring-1 focus:ring-stone-900"
              />
              {error && <p className="text-xs text-red-500">{error}</p>}
              <button
                type="submit"
                className="px-6 py-3 bg-stone-900 text-white text-sm hover:bg-stone-700 transition-colors"
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
          <circle key={i} cx={d.x} cy={d.y} r={1.3} fill="#9ca3af" opacity={d.opacity * 0.6} />
        ))}
      </svg>
    </div>
  );
}
