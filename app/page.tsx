'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';

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

interface Dot {
  baseX: number;
  baseY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  baseOpacity: number;
  phase: number;
}

function buildDots(width: number, height: number): Dot[] {
  const dots: Dot[] = [];
  const spacing = 13;
  for (let col = 0; col * spacing <= width + spacing; col++) {
    for (let row = 0; row * spacing <= height + spacing; row++) {
      const bx = spacing / 2 + col * spacing;
      const by = spacing / 2 + row * spacing;
      dots.push({
        baseX: bx, baseY: by,
        x: bx, y: by,
        vx: 0, vy: 0,
        r: 1.4,
        baseOpacity: 0.45 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }
  return dots;
}

function DotField() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const mouseRef    = useRef({ x: -9999, y: -9999 });
  const dotsRef     = useRef<Dot[]>([]);
  const animRef     = useRef<number>(0);
  const sizeRef     = useRef({ width: 0, height: 0 });
  const tRef        = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function init(width: number, height: number) {
      canvas!.width  = width;
      canvas!.height = height;
      sizeRef.current = { width, height };
      dotsRef.current = buildDots(width, height);
    }

    const SPRING_K      = 0.07;
    const DAMPING       = 0.72;
    const REPEL_RADIUS  = 110;
    const REPEL_STRENGTH = 48;

    function frame() {
      const { width, height } = sizeRef.current;
      ctx.clearRect(0, 0, width, height);
      tRef.current += 0.014;
      const t  = tRef.current;
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      for (const dot of dotsRef.current) {
        // Repulsion target: push base position away from cursor
        const dxM  = dot.baseX - mx;
        const dyM  = dot.baseY - my;
        const distM = Math.sqrt(dxM * dxM + dyM * dyM);
        let targetX = dot.baseX;
        let targetY = dot.baseY;
        if (distM < REPEL_RADIUS && distM > 0) {
          const force = (1 - distM / REPEL_RADIUS) * REPEL_STRENGTH;
          targetX = dot.baseX + (dxM / distM) * force;
          targetY = dot.baseY + (dyM / distM) * force;
        }

        // Spring toward target
        dot.vx = (dot.vx + (targetX - dot.x) * SPRING_K) * DAMPING;
        dot.vy = (dot.vy + (targetY - dot.y) * SPRING_K) * DAMPING;
        dot.x += dot.vx;
        dot.y += dot.vy;

        // Ambient pulse: slow breathing per dot
        const pulse = 0.62 + Math.sin(t * 0.75 + dot.phase) * 0.38;
        const r     = dot.r * (0.82 + Math.sin(t * 0.55 + dot.phase * 1.4) * 0.22);

        ctx.beginPath();
        ctx.arc(dot.x, dot.y, Math.max(r, 0.3), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(22, 22, 22, ${dot.baseOpacity * pulse})`;
        ctx.fill();
      }

      animRef.current = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      cancelAnimationFrame(animRef.current);
      init(width, height);
      animRef.current = requestAnimationFrame(frame);
    });
    ro.observe(container);

    return () => {
      cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }}
        onMouseLeave={() => { mouseRef.current = { x: -9999, y: -9999 }; }}
      />
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const [inputValue, setInputValue] = useState('');
  const [showInput, setShowInput]   = useState(false);
  const [error, setError]           = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (showInput) {
      setTimeout(() => inputRef.current?.focus(), 180);
    }
  }, [showInput]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseGitHubUrl(inputValue);
    if (!parsed) {
      setError('Paste a valid GitHub repo URL');
      return;
    }
    setError('');
    router.push(`/repo/${parsed.owner}/${parsed.repo}`);
  }

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* Left decorative panel */}
      <div className="w-[30%] relative flex-shrink-0 bg-muted overflow-hidden">
        <DotField />
      </div>

      {/* Right content panel */}
      <div className="flex-1 flex flex-col justify-center px-16 bg-card">
        <div className="max-w-[50%]">
          <p className="text-5xl font-light leading-[1.1] text-foreground mb-1">
            Git visualizer
          </p>
          <h1 className="text-5xl font-bold leading-[1.1] text-foreground mb-16">
            See what your team is building, without reading a line of code.
          </h1>
        </div>

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

          {/* Animated enter-repo button → input */}
          <div className="relative h-[42px] w-60 rounded-lg overflow-hidden"
            style={{
              backgroundColor: showInput ? 'transparent' : 'var(--primary)',
              border: showInput ? '1px solid var(--foreground)' : '1px solid transparent',
              transition: 'background-color 0.2s ease, border-color 0.2s ease',
            }}
          >
            {/* Button label */}
            <button
              onClick={() => setShowInput(true)}
              className="absolute inset-0 flex items-center justify-center text-primary-foreground text-sm transition-opacity duration-150"
              style={{ opacity: showInput ? 0 : 1, pointerEvents: showInput ? 'none' : 'auto' }}
            >
              Enter GitHub repo link
            </button>

            {/* Input + arrow */}
            <form
              onSubmit={handleSubmit}
              className="absolute inset-0 flex items-center transition-opacity duration-150"
              style={{ opacity: showInput ? 1 : 0, pointerEvents: showInput ? 'auto' : 'none' }}
            >
              <div
                className="flex-1 h-full min-w-0"
                style={{
                  maskImage: 'linear-gradient(to right, black calc(100% - 40px), transparent 100%)',
                  WebkitMaskImage: 'linear-gradient(to right, black calc(100% - 40px), transparent 100%)',
                }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={e => { setInputValue(e.target.value); setError(''); }}
                  placeholder="Enter link"
                  className="w-full h-full px-3 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                />
              </div>
              <button
                type="submit"
                className="shrink-0 m-1 w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center hover:opacity-90 transition-opacity"
              >
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

          {error && <p className="text-xs text-destructive -mt-1">{error}</p>}
        </div>
      </div>
    </main>
  );
}
