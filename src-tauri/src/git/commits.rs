use super::cli::{self, GitError};
use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeNode {
    pub sha: String,
    pub full_sha: String,
    pub pr_number: Option<i32>,
    pub pr_title: Option<String>,
    pub date: String,
}

/// Get merge commits from a branch (commits with 2+ parents)
pub fn get_merge_commits(
    repo: &Path,
    branch: &str,
    page: u32,
    per_page: u32,
) -> Result<(Vec<MergeNode>, bool), GitError> {
    let skip = page * per_page;
    // Fetch one extra to determine if there are more
    let limit = per_page + 1;

    let output = cli::run(
        repo,
        &[
            "log",
            "--merges",
            &format!("--max-count={}", limit),
            &format!("--skip={}", skip),
            "--format=%H|%h|%s|%aI",
            branch,
        ],
    )?;

    let mut nodes: Vec<MergeNode> = output
        .lines()
        .filter(|s| !s.is_empty())
        .filter_map(|line| parse_merge_commit(line))
        .collect();

    // Check if there are more results
    let has_more = nodes.len() > per_page as usize;
    if has_more {
        nodes.pop(); // Remove the extra one we fetched
    }

    Ok((nodes, has_more))
}

fn parse_merge_commit(line: &str) -> Option<MergeNode> {
    let parts: Vec<&str> = line.splitn(4, '|').collect();
    if parts.len() < 4 {
        return None;
    }

    let full_sha = parts[0].to_string();
    let sha = parts[1].to_string();
    let subject = parts[2];
    let date = parts[3].to_string();

    // Parse PR number from commit message
    // Common formats:
    // "Merge pull request #123 from user/branch"
    // "Merge branch 'feature' (#123)"
    let (pr_number, pr_title) = parse_pr_info(subject);

    Some(MergeNode {
        sha,
        full_sha,
        pr_number,
        pr_title,
        date,
    })
}

fn parse_pr_info(subject: &str) -> (Option<i32>, Option<String>) {
    // Try "Merge pull request #123 from ..."
    if subject.starts_with("Merge pull request #") {
        if let Some(rest) = subject.strip_prefix("Merge pull request #") {
            let parts: Vec<&str> = rest.splitn(2, ' ').collect();
            if let Some(num_str) = parts.first() {
                if let Ok(num) = num_str.parse::<i32>() {
                    // Extract title from "from user/branch-name"
                    let title = parts.get(1).map(|s| {
                        s.strip_prefix("from ")
                            .unwrap_or(s)
                            .to_string()
                    });
                    return (Some(num), title);
                }
            }
        }
    }

    // Try "(#123)" anywhere in the message
    if let Some(start) = subject.find("(#") {
        if let Some(end) = subject[start..].find(')') {
            let num_str = &subject[start + 2..start + end];
            if let Ok(num) = num_str.parse::<i32>() {
                // Use the part before (#123) as title
                let title = subject[..start].trim().to_string();
                return (Some(num), if title.is_empty() { None } else { Some(title) });
            }
        }
    }

    // Try "#123" anywhere
    for (i, _) in subject.match_indices('#') {
        let rest = &subject[i + 1..];
        let num_end = rest.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest.len());
        if num_end > 0 {
            if let Ok(num) = rest[..num_end].parse::<i32>() {
                return (Some(num), None);
            }
        }
    }

    (None, None)
}
