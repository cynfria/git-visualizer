import { NextRequest, NextResponse } from 'next/server';
import { fetchBranches } from '@/lib/github';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');

  if (!owner || !repo) {
    return NextResponse.json({ error: 'owner and repo are required' }, { status: 400 });
  }

  const page = parseInt(searchParams.get('page') ?? '1', 10);
  const knownDefaultBranch = searchParams.get('defaultBranch') ?? undefined;
  const token: string | undefined = process.env.GITHUB_PAT;

  try {
    const result = await fetchBranches(owner, repo, token, page, knownDefaultBranch);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
