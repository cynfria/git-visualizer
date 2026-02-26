use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Command;

use crate::git;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubInfo {
    pub owner: String,
    pub repo: String,
    pub gh_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedPR {
    pub number: i64,
    pub title: String,
    pub branch_name: String,
    pub author_login: String,
    pub author_avatar: String,
    pub created_at: String,
    pub merged_at: String,
    pub merge_commit_sha: String,
    pub commit_count: i64,
}

/// Response from GitHub API for a pull request
#[derive(Debug, Deserialize)]
struct GitHubPR {
    number: i64,
    title: String,
    state: String,
    merged_at: Option<String>,
    created_at: String,
    merge_commit_sha: Option<String>,
    commits: Option<i64>,
    head: GitHubHead,
    user: GitHubUser,
}

#[derive(Debug, Deserialize)]
struct GitHubHead {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Debug, Deserialize)]
struct GitHubUser {
    login: String,
    avatar_url: String,
}

/// Parse GitHub owner/repo from a git remote URL.
/// Supports formats:
/// - git@github.com:owner/repo.git
/// - https://github.com/owner/repo.git
/// - https://github.com/owner/repo
pub fn parse_remote_url(url: &str) -> Option<(String, String)> {
    let url = url.trim();

    // SSH format: git@github.com:owner/repo.git
    if let Some(rest) = url.strip_prefix("git@github.com:") {
        let rest = rest.strip_suffix(".git").unwrap_or(rest);
        let parts: Vec<&str> = rest.split('/').collect();
        if parts.len() == 2 {
            return Some((parts[0].to_string(), parts[1].to_string()));
        }
    }

    // HTTPS format: https://github.com/owner/repo.git
    if url.contains("github.com") {
        let url = url.strip_suffix(".git").unwrap_or(url);
        // Find github.com and take the path after it
        if let Some(idx) = url.find("github.com") {
            let rest = &url[idx + "github.com".len()..];
            let rest = rest.strip_prefix('/').unwrap_or(rest);
            let parts: Vec<&str> = rest.split('/').collect();
            if parts.len() >= 2 {
                return Some((parts[0].to_string(), parts[1].to_string()));
            }
        }
    }

    None
}

/// Get GitHub info from a local repository by reading its remote URL.
pub fn get_github_info(repo_path: &Path) -> Result<GitHubInfo, String> {
    // Get the remote URL
    let remote_url = git::cli::run(repo_path, &["remote", "get-url", "origin"])
        .map_err(|e| format!("Failed to get remote URL: {e}"))?;

    let (owner, repo) = parse_remote_url(&remote_url)
        .ok_or_else(|| format!("Could not parse GitHub info from remote URL: {}", remote_url.trim()))?;

    // Check if gh CLI is available
    let gh_available = Command::new("gh")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);

    Ok(GitHubInfo {
        owner,
        repo,
        gh_available,
    })
}

/// Response type for PR commits
#[derive(Debug, Deserialize)]
struct GitHubCommit {
    sha: String,
}

/// Fetch commit SHAs for multiple PRs in parallel.
/// Returns a map of PR number to list of short SHAs.
pub fn get_pr_commits(
    owner: &str,
    repo: &str,
    pr_numbers: &[i64],
) -> Result<std::collections::HashMap<i64, Vec<String>>, String> {
    use std::collections::HashMap;
    use std::thread;

    let mut results = HashMap::new();

    // Fetch commits for each PR (could be parallelized further with rayon if needed)
    let handles: Vec<_> = pr_numbers
        .iter()
        .map(|&num| {
            let owner = owner.to_string();
            let repo = repo.to_string();
            thread::spawn(move || {
                let output = Command::new("gh")
                    .args([
                        "api",
                        &format!("repos/{owner}/{repo}/pulls/{num}/commits?per_page=100"),
                    ])
                    .output();

                match output {
                    Ok(out) if out.status.success() => {
                        let stdout = String::from_utf8_lossy(&out.stdout);
                        if let Ok(commits) = serde_json::from_str::<Vec<GitHubCommit>>(&stdout) {
                            let shas: Vec<String> = commits
                                .iter()
                                .map(|c| c.sha[..7.min(c.sha.len())].to_string())
                                .collect();
                            Some((num, shas))
                        } else {
                            None
                        }
                    }
                    _ => None,
                }
            })
        })
        .collect();

    for handle in handles {
        if let Ok(Some((num, shas))) = handle.join() {
            results.insert(num, shas);
        }
    }

    Ok(results)
}

/// Fetch merged PRs from GitHub using the gh CLI.
/// Returns PRs merged into the specified base branch.
pub fn get_merged_prs(
    owner: &str,
    repo: &str,
    base_branch: &str,
    limit: usize,
) -> Result<Vec<MergedPR>, String> {
    // Use gh api to fetch closed PRs
    // We fetch more than we need since not all closed PRs are merged
    let fetch_limit = limit * 2;

    let output = Command::new("gh")
        .args([
            "api",
            &format!(
                "repos/{owner}/{repo}/pulls?state=closed&base={base_branch}&per_page={fetch_limit}&sort=updated&direction=desc"
            ),
        ])
        .output()
        .map_err(|e| format!("Failed to run gh CLI: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("gh api failed: {stderr}"));
    }

    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "Invalid UTF-8 in gh output")?;

    let prs: Vec<GitHubPR> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse GitHub response: {e}"))?;

    // Filter to only merged PRs and convert to our type
    let merged: Vec<MergedPR> = prs
        .into_iter()
        .filter_map(|pr| {
            // Only include PRs that were actually merged
            let merged_at = pr.merged_at?;
            let merge_commit_sha = pr.merge_commit_sha?;

            Some(MergedPR {
                number: pr.number,
                title: pr.title,
                branch_name: pr.head.ref_name,
                author_login: pr.user.login,
                author_avatar: pr.user.avatar_url,
                created_at: pr.created_at,
                merged_at,
                merge_commit_sha,
                commit_count: pr.commits.unwrap_or(1),
            })
        })
        .take(limit)
        .collect();

    Ok(merged)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_ssh_url() {
        let url = "git@github.com:anthropics/claude-code.git";
        assert_eq!(
            parse_remote_url(url),
            Some(("anthropics".to_string(), "claude-code".to_string()))
        );
    }

    #[test]
    fn test_parse_https_url() {
        let url = "https://github.com/anthropics/claude-code.git";
        assert_eq!(
            parse_remote_url(url),
            Some(("anthropics".to_string(), "claude-code".to_string()))
        );
    }

    #[test]
    fn test_parse_https_url_no_git_suffix() {
        let url = "https://github.com/anthropics/claude-code";
        assert_eq!(
            parse_remote_url(url),
            Some(("anthropics".to_string(), "claude-code".to_string()))
        );
    }
}
