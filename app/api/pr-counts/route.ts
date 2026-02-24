import { NextRequest, NextResponse } from 'next/server';

const GITHUB_API = 'https://api.github.com';

function makeHeaders(token?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

// GET /api/pr-counts?owner=&repo=&numbers=1,2,3,...
// Fetches real commit counts for a list of PR numbers in parallel server-side.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get('owner');
  const repo = searchParams.get('repo');
  const numbers = searchParams.get('numbers');

  if (!owner || !repo || !numbers) {
    return NextResponse.json({ error: 'owner, repo, numbers required' }, { status: 400 });
  }

  const token = process.env.GITHUB_PAT;
  const headers = makeHeaders(token);

  const prNumbers = numbers
    .split(',')
    .map((n) => parseInt(n))
    .filter((n) => !isNaN(n))
    .slice(0, 100); // cap at 100

  const results = await Promise.all(
    prNumbers.map(async (num) => {
      try {
        const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/pulls/${num}`, { headers });
        if (!res.ok) return { number: num, commits: null };
        const data = await res.json();
        return { number: num, commits: typeof data.commits === 'number' ? data.commits : null };
      } catch {
        return { number: num, commits: null };
      }
    })
  );

  const counts: Record<string, number> = {};
  for (const r of results) {
    if (r.commits !== null) counts[r.number] = r.commits;
  }

  return NextResponse.json(counts);
}
