import { Branch, BranchStatus, Commit, MergeNode, ChangedFile, ComponentGroup } from '@/types';

const GITHUB_API = 'https://api.github.com';
const STALE_DAYS = 14;

function makeHeaders(token?: string) {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function staleness(lastCommitDate: string): BranchStatus {
  const days = (Date.now() - new Date(lastCommitDate).getTime()) / (1000 * 60 * 60 * 24);
  return days >= STALE_DAYS ? 'stale' : 'fresh';
}

export async function fetchBranches(
  owner: string,
  repo: string,
  token?: string
): Promise<{ branches: Branch[]; defaultBranch: string }> {
  const headers = makeHeaders(token);

  // Get repo info for default branch
  const repoRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { headers });
  if (!repoRes.ok) throw new Error(`Repo fetch failed: ${repoRes.status}`);
  const repoData = await repoRes.json();
  const defaultBranch: string = repoData.default_branch ?? 'main';

  // List all branches
  const branchListRes = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/branches?per_page=100`,
    { headers }
  );
  if (!branchListRes.ok) throw new Error(`Branches fetch failed: ${branchListRes.status}`);
  const branchList = await branchListRes.json();

  // Compare each branch to default in parallel
  const branches: Branch[] = await Promise.all(
    branchList.map(async (b: { name: string; commit: { sha: string; commit: { author: { date: string; name: string } } }; }) => {
      const name: string = b.name;
      const lastCommitDate: string = b.commit.commit.author.date;
      const lastCommitAuthor: string = b.commit.commit.author.name;
      const headSha: string = b.commit.sha;

      if (name === defaultBranch) {
        return {
          name,
          commitsAhead: 0,
          commitsBehind: 0,
          lastCommitDate,
          lastCommitAuthor,
          lastCommitAuthorAvatar: '',
          mergeable: null,
          status: 'fresh' as BranchStatus,
          headSha,
        };
      }

      try {
        const compareRes = await fetch(
          `${GITHUB_API}/repos/${owner}/${repo}/compare/${defaultBranch}...${encodeURIComponent(name)}`,
          { headers }
        );
        if (!compareRes.ok) {
          return {
            name,
            commitsAhead: 0,
            commitsBehind: 0,
            lastCommitDate,
            lastCommitAuthor,
            lastCommitAuthorAvatar: '',
            mergeable: null,
            status: staleness(lastCommitDate),
            headSha,
          };
        }
        const compare = await compareRes.json();
        const commitsAhead: number = compare.ahead_by ?? 0;
        const commitsBehind: number = compare.behind_by ?? 0;
        const divergedFromSha: string = compare.merge_base_commit?.sha;
        const mergeable: boolean | null = compare.mergeable ?? null;

        let status: BranchStatus;
        if (mergeable === false) {
          status = 'conflict-risk';
        } else {
          status = staleness(lastCommitDate);
        }

        // Get author avatar from latest commit
        let lastCommitAuthorAvatar = '';
        try {
          const commitRes = await fetch(
            `${GITHUB_API}/repos/${owner}/${repo}/commits/${headSha}`,
            { headers }
          );
          if (commitRes.ok) {
            const commitData = await commitRes.json();
            lastCommitAuthorAvatar = commitData.author?.avatar_url ?? '';
          }
        } catch {}

        return {
          name,
          commitsAhead,
          commitsBehind,
          lastCommitDate,
          lastCommitAuthor,
          lastCommitAuthorAvatar,
          mergeable,
          status,
          divergedFromSha,
          headSha,
        };
      } catch {
        return {
          name,
          commitsAhead: 0,
          commitsBehind: 0,
          lastCommitDate,
          lastCommitAuthor,
          lastCommitAuthorAvatar: '',
          mergeable: null,
          status: 'unknown' as BranchStatus,
          headSha,
        };
      }
    })
  );

  return { branches, defaultBranch };
}

export async function fetchBranchCommits(
  owner: string,
  repo: string,
  branch: string,
  base: string,
  token?: string
): Promise<Commit[]> {
  const headers = makeHeaders(token);
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/compare/${base}...${encodeURIComponent(branch)}`,
    { headers }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.commits ?? []).map((c: { sha: string; commit: { message: string; author: { name: string; date: string } }; author: { avatar_url: string } | null }) => ({
    sha: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name,
    authorAvatar: c.author?.avatar_url ?? '',
    date: c.commit.author.date,
  }));
}

export async function fetchChangedFiles(
  owner: string,
  repo: string,
  branch: string,
  base: string,
  token?: string
): Promise<{ files: ChangedFile[]; groups: ComponentGroup[] }> {
  const headers = makeHeaders(token);
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/compare/${base}...${encodeURIComponent(branch)}`,
    { headers }
  );
  if (!res.ok) return { files: [], groups: [] };
  const data = await res.json();
  const files: ChangedFile[] = (data.files ?? []).map((f: { filename: string; additions: number; deletions: number; status: string }) => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
    status: f.status,
  }));

  // Group by top-level feature folder
  const groupMap = new Map<string, ComponentGroup>();
  for (const file of files) {
    const parts = file.filename.split('/');
    const folder = parts.length > 1 ? parts.slice(0, 2).join('/') : parts[0];
    const label = cleanFolderLabel(folder);
    if (!groupMap.has(folder)) {
      groupMap.set(folder, { label, folder, additions: 0, deletions: 0, files: [] });
    }
    const g = groupMap.get(folder)!;
    g.additions += file.additions;
    g.deletions += file.deletions;
    g.files.push(file);
  }

  return { files, groups: Array.from(groupMap.values()) };
}

function cleanFolderLabel(folder: string): string {
  const last = folder.split('/').pop() ?? folder;
  return last
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function fetchMainMergeNodes(
  owner: string,
  repo: string,
  defaultBranch: string,
  token?: string
): Promise<MergeNode[]> {
  const headers = makeHeaders(token);
  const res = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/commits?sha=${defaultBranch}&per_page=30`,
    { headers }
  );
  if (!res.ok) return [];
  const commits = await res.json();

  return commits.map((c: { sha: string; commit: { message: string; author: { date: string } } }) => {
    const prMatch = c.commit.message.match(/#(\d+)/);
    const titleLine = c.commit.message.split('\n')[0];
    return {
      sha: c.sha.slice(0, 7),
      prNumber: prMatch ? parseInt(prMatch[1]) : null,
      prTitle: titleLine,
      date: c.commit.author.date,
    };
  });
}
