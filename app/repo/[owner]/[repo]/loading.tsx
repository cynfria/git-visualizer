'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';

export default function Loading() {
  const { owner, repo } = useParams<{ owner: string; repo: string }>();

  return (
    <div className="h-screen flex flex-col bg-background">
      <PageHeader
        left={
          <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        }
        center={
          <h1 className="text-sm font-medium text-foreground" style={{ fontFamily: 'var(--font-space-grotesk), system-ui, sans-serif' }}>
            {owner}/{decodeURIComponent(repo)}
          </h1>
        }
      />
      <div className="flex-1 flex items-center justify-center">
        <div className="flex gap-1.5">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
