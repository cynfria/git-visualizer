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
// Fetches the commit SHAs for each PR in parallel server-side.
// Returns { [prNumber]: string[] } — array of 7-char SHAs in order.
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
    .slice(0, 100);

  const results = await Promise.all(
    prNumbers.map(async (num) => {
      try {
        const res = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/pulls/${num}/commits?per_page=100`,
          { headers }
        );
        if (!res.ok) return { number: num, shas: null };
        const commits = await res.json();
        if (!Array.isArray(commits)) return { number: num, shas: null };
        const shas = commits.map((c: { sha: string }) => c.sha.slice(0, 7));
        return { number: num, shas };
      } catch {
        return { number: num, shas: null };
      }
    })
  );

  const out: Record<string, string[]> = {};
  for (const r of results) {
    if (r.shas !== null) out[r.number] = r.shas;
  }

  return NextResponse.json(out);
}
