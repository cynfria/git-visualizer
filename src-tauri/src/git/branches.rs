use super::cli::{self, GitError};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub name: String,
    pub commits_ahead: i32,
    pub commits_behind: i32,
    pub last_commit_date: String,
    pub last_commit_author: String,
    pub status: String,
    pub head_sha: String,
    pub diverged_from_sha: Option<String>,
    pub diverged_from_date: Option<String>,
}

/// Get the default branch name (usually main or master)
pub fn get_default_branch(repo: &Path) -> Result<String, GitError> {
    // Try to get from origin HEAD
    if let Ok(output) = cli::run(repo, &["symbolic-ref", "refs/remotes/origin/HEAD"]) {
        let trimmed = output.trim();
        if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
            return Ok(branch.to_string());
        }
    }

    // Fallback: check if main exists
    if cli::run(repo, &["rev-parse", "--verify", "main"]).is_ok() {
        return Ok("main".to_string());
    }

    // Fallback: check if master exists
    if cli::run(repo, &["rev-parse", "--verify", "master"]).is_ok() {
        return Ok("master".to_string());
    }

    // Last resort: use HEAD
    Ok("HEAD".to_string())
}

/// Get repository info (name and path)
pub fn get_repo_info(repo: &Path) -> Result<(String, String), GitError> {
    let output = cli::run(repo, &["rev-parse", "--show-toplevel"])?;
    let full_path = output.trim().to_string();

    let name = Path::new(&full_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    Ok((name, full_path))
}

/// List all branches with their metadata
pub fn list_branches(repo: &Path, default_branch: &str) -> Result<Vec<Branch>, GitError> {
    // Get all local branches
    let output = cli::run(repo, &["branch", "--format=%(refname:short)"])?;

    let branch_names: Vec<&str> = output
        .lines()
        .filter(|s| !s.is_empty() && *s != default_branch)
        .collect();

    let mut branches = Vec::new();

    for name in branch_names {
        if let Ok(branch) = get_branch_info(repo, name, default_branch) {
            branches.push(branch);
        }
    }

    // Sort by last commit date (most recent first)
    branches.sort_by(|a, b| b.last_commit_date.cmp(&a.last_commit_date));

    Ok(branches)
}

fn get_branch_info(repo: &Path, name: &str, default_branch: &str) -> Result<Branch, GitError> {
    // Get ahead/behind counts
    let (commits_ahead, commits_behind) = get_ahead_behind(repo, name, default_branch)?;

    // Get last commit info: SHA, author, date
    let log_output = cli::run(
        repo,
        &["log", "-1", "--format=%H|%an|%aI", name],
    )?;
    let parts: Vec<&str> = log_output.trim().split('|').collect();

    let head_sha = parts.first().unwrap_or(&"").to_string();
    let last_commit_author = parts.get(1).unwrap_or(&"Unknown").to_string();
    let last_commit_date = parts.get(2).unwrap_or(&"").to_string();

    // Get merge base (fork point)
    let (diverged_from_sha, diverged_from_date) = get_fork_point(repo, name, default_branch)?;

    // Calculate status
    let status = calculate_status(commits_behind, &last_commit_date);

    Ok(Branch {
        name: name.to_string(),
        commits_ahead,
        commits_behind,
        last_commit_date,
        last_commit_author,
        status,
        head_sha,
        diverged_from_sha,
        diverged_from_date,
    })
}

fn get_ahead_behind(repo: &Path, branch: &str, base: &str) -> Result<(i32, i32), GitError> {
    let output = cli::run(
        repo,
        &["rev-list", "--left-right", "--count", &format!("{}...{}", base, branch)],
    )?;

    let parts: Vec<&str> = output.trim().split_whitespace().collect();
    let behind = parts.first().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ahead = parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

    Ok((ahead, behind))
}

fn get_fork_point(repo: &Path, branch: &str, base: &str) -> Result<(Option<String>, Option<String>), GitError> {
    let merge_base = cli::run(repo, &["merge-base", base, branch])?;
    let sha = merge_base.trim();

    if sha.is_empty() {
        return Ok((None, None));
    }

    let date_output = cli::run(repo, &["log", "-1", "--format=%aI", sha])?;
    let date = date_output.trim().to_string();

    Ok((Some(sha.to_string()), Some(date)))
}

fn calculate_status(commits_behind: i32, last_commit_date: &str) -> String {
    // Parse the date and check if it's stale (more than 7 days old)
    if commits_behind > 50 {
        return "stale".to_string();
    }

    if commits_behind > 10 {
        return "conflict-risk".to_string();
    }

    // Check date freshness
    if let Ok(commit_date) = chrono::DateTime::parse_from_rfc3339(last_commit_date) {
        let now = chrono::Utc::now();
        let days_old = (now - commit_date.with_timezone(&chrono::Utc)).num_days();

        if days_old > 14 {
            return "stale".to_string();
        }
    }

    "fresh".to_string()
}
