mod git;
mod github;

use git::{Branch, MergeNode};
use github::{GitHubInfo, MergedPR};
use std::path::Path;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    name: String,
    path: String,
}

// =============================================================================
// Directory Browsing
// =============================================================================

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    is_repo: bool,
}

/// List contents of a directory.
/// Returns directories first (sorted), then files (sorted).
/// For directories, also indicates if they are git repositories.
#[tauri::command(rename_all = "camelCase")]
fn list_directory(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);

    if !dir.exists() {
        return Err(format!("Directory does not exist: {path}"));
    }

    if !dir.is_dir() {
        return Err(format!("Not a directory: {path}"));
    }

    let mut dirs = Vec::new();
    let mut files = Vec::new();

    let entries = std::fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {e}"))?;

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }

        let entry_path = entry.path();
        let is_dir = entry_path.is_dir();
        let is_repo = is_dir && entry_path.join(".git").exists();

        let item = DirEntry {
            name,
            path: entry_path.to_string_lossy().to_string(),
            is_dir,
            is_repo,
        };

        if is_dir {
            dirs.push(item);
        } else {
            files.push(item);
        }
    }

    // Sort alphabetically (case-insensitive)
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Directories first, then files
    dirs.extend(files);
    Ok(dirs)
}

/// Folders to skip during search - system folders unlikely to contain projects.
const SKIP_FOLDERS: &[&str] = &[
    // macOS system
    "Library",
    "Applications",
    "System",
    "Volumes",
    "cores",
    "private",
    // Common non-project folders
    "node_modules",
    "target",
    "build",
    "dist",
    "vendor",
    ".git",
    "__pycache__",
    "venv",
    ".venv",
    "env",
    ".cargo",
    ".rustup",
    ".npm",
    ".cache",
    "Caches",
    // Media/documents unlikely to have repos
    "Movies",
    "Music",
    "Pictures",
    "Photos Library.photoslibrary",
];

/// Common development folder names - search these when at home directory.
const DEV_FOLDERS: &[&str] = &[
    "dev",
    "projects",
    "code",
    "repos",
    "src",
    "workspace",
    "work",
    "github",
    "gitlab",
    "Development",
    "Documents",
    "Desktop",
];

/// Search for git repositories matching a query.
/// Only returns directories containing a .git folder.
/// When at home directory, only searches inside common dev folders.
/// Returns up to `limit` matches sorted by relevance.
#[tauri::command(rename_all = "camelCase")]
fn search_directories(
    path: String,
    query: String,
    max_depth: Option<u32>,
    limit: Option<usize>,
) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);
    let max_depth = max_depth.unwrap_or(6);
    let limit = limit.unwrap_or(20);
    let query_lower = query.to_lowercase();

    if !dir.exists() || !dir.is_dir() {
        return Err(format!("Invalid directory: {path}"));
    }

    let mut results = Vec::new();
    let collect_limit = limit * 3;

    // Check if we're at the home directory
    let home_dir = dirs::home_dir();
    let is_home = home_dir.as_ref().is_some_and(|h| h == dir);

    if is_home {
        // When at home, only search inside common dev folders
        for dev_folder in DEV_FOLDERS {
            let dev_path = dir.join(dev_folder);
            if dev_path.exists() && dev_path.is_dir() {
                search_repos_recursive(
                    &dev_path,
                    &query_lower,
                    0,
                    max_depth,
                    &mut results,
                    collect_limit,
                );
                if results.len() >= collect_limit {
                    break;
                }
            }
        }
    } else {
        // Normal recursive search for non-home directories
        search_repos_recursive(dir, &query_lower, 0, max_depth, &mut results, collect_limit);
    }

    // Sort results by relevance:
    // 1. Exact matches first
    // 2. Then by path depth (shallower = better)
    results.sort_by(|a, b| {
        let a_exact = a.name.to_lowercase() == query_lower;
        let b_exact = b.name.to_lowercase() == query_lower;
        if a_exact != b_exact {
            return b_exact.cmp(&a_exact); // exact matches first
        }

        let a_depth = a.path.matches('/').count();
        let b_depth = b.path.matches('/').count();
        a_depth.cmp(&b_depth) // shallower first
    });
    results.truncate(limit);

    Ok(results)
}

/// Recursive helper for searching git repositories.
fn search_repos_recursive(
    dir: &Path,
    query: &str,
    depth: u32,
    max_depth: u32,
    results: &mut Vec<DirEntry>,
    limit: usize,
) -> bool {
    if depth > max_depth || results.len() >= limit {
        return results.len() >= limit;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return false,
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden directories
        if name.starts_with('.') {
            continue;
        }

        // Skip system/non-project folders
        if SKIP_FOLDERS.contains(&name.as_str()) {
            continue;
        }

        let entry_path = entry.path();
        if !entry_path.is_dir() {
            continue;
        }

        // Check if this is a git repository
        let is_repo = entry_path.join(".git").exists();

        if is_repo {
            // Only add if name matches query
            let name_lower = name.to_lowercase();
            if query.is_empty() || name_lower.starts_with(query) || name_lower.contains(query) {
                results.push(DirEntry {
                    name: name.clone(),
                    path: entry_path.to_string_lossy().to_string(),
                    is_dir: true,
                    is_repo: true,
                });

                if results.len() >= limit {
                    return true;
                }
            }
            // Don't recurse into repos (nested repos are rare)
        } else {
            // Not a repo, recurse to find repos inside
            if search_repos_recursive(&entry_path, query, depth + 1, max_depth, results, limit) {
                return true;
            }
        }
    }

    false
}

/// Get the user's home directory.
#[tauri::command]
fn get_home_dir() -> Result<String, String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not determine home directory".to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeNodesResponse {
    nodes: Vec<MergeNode>,
    has_more: bool,
}

#[tauri::command]
fn get_branches(repo_path: String) -> Result<Vec<Branch>, String> {
    let path = Path::new(&repo_path);
    let default = git::get_default_branch(path).unwrap_or_else(|_| "main".to_string());
    git::list_branches(path, &default).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_merge_nodes(
    repo_path: String,
    branch: String,
    page: u32,
    per_page: u32,
) -> Result<MergeNodesResponse, String> {
    let path = Path::new(&repo_path);
    let (nodes, has_more) =
        git::get_merge_commits(path, &branch, page, per_page).map_err(|e| e.to_string())?;
    Ok(MergeNodesResponse { nodes, has_more })
}

#[tauri::command]
fn get_default_branch(repo_path: String) -> Result<String, String> {
    let path = Path::new(&repo_path);
    git::get_default_branch(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_repo_info(repo_path: String) -> Result<RepoInfo, String> {
    let path = Path::new(&repo_path);
    let (name, full_path) = git::get_repo_info(path).map_err(|e| e.to_string())?;
    Ok(RepoInfo {
        name,
        path: full_path,
    })
}

// =============================================================================
// GitHub Integration
// =============================================================================

#[tauri::command]
fn get_github_info(repo_path: String) -> Result<GitHubInfo, String> {
    let path = Path::new(&repo_path);
    github::get_github_info(path)
}

#[tauri::command(rename_all = "camelCase")]
fn get_merged_prs(
    owner: String,
    repo: String,
    base_branch: String,
    limit: Option<usize>,
) -> Result<Vec<MergedPR>, String> {
    let limit = limit.unwrap_or(50);
    github::get_merged_prs(&owner, &repo, &base_branch, limit)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            get_branches,
            get_merge_nodes,
            get_default_branch,
            get_repo_info,
            get_github_info,
            get_merged_prs,
            list_directory,
            search_directories,
            get_home_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
