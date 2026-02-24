import { NextRequest, NextResponse } from 'next/server';
import { fetchMainMergeNodes } from '@/lib/github';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const sha = searchParams.get('sha') ?? 'main';
  const page = parseInt(searchParams.get('page') ?? '1');
  const perPage = Math.min(parseInt(searchParams.get('per_page') ?? '30'), 100);

  if (!owner || !repo) {
    return NextResponse.json({ error: 'owner and repo are required' }, { status: 400 });
  }

  const token = process.env.GITHUB_PAT;

  try {
    const result = await fetchMainMergeNodes(owner, repo, sha, token, page, perPage);
    return NextResponse.json({ nodes: result.nodes, hasMore: result.hasMore });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
