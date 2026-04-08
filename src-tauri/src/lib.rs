mod git;
mod github;

use tauri::Manager;

use git::{Branch, DirectCommit, MergeNode};
use github::{GitHubInfo, MergedPR, OpenPR};
use std::path::Path;

/// Resolve a CLI binary name to its full path.
/// Checks common Homebrew / nvm / system locations so the app works when
/// launched from a .app bundle where $PATH is minimal.
fn resolve_bin(name: &str) -> String {
    for dir in dev_path_dirs() {
        let candidate = format!("{dir}/{name}");
        if std::path::Path::new(&candidate).exists() {
            return candidate;
        }
    }
    // Fall back to bare name — shell PATH may still work in dev mode
    name.to_string()
}

/// Build a PATH string that includes all common Node/package-manager locations.
/// Used when spawning child processes from a .app bundle where $PATH is minimal.
fn dev_path_env() -> String {
    let home = std::env::var("HOME").unwrap_or_default();
    let mut dirs: Vec<String> = vec![
        "/opt/homebrew/bin".into(),
        "/opt/homebrew/sbin".into(),
        "/usr/local/bin".into(),
        "/usr/bin".into(),
        "/bin".into(),
        "/usr/sbin".into(),
        "/sbin".into(),
        format!("{home}/.volta/bin"),
        format!("{home}/.cargo/bin"),
        format!("{home}/n/bin"),
    ];

    // Resolve the active nvm node version directory, if present
    let nvm_versions = std::path::Path::new(&home).join(".nvm/versions/node");
    if nvm_versions.exists() {
        if let Ok(entries) = std::fs::read_dir(&nvm_versions) {
            let mut versions: Vec<_> = entries.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect();
            versions.sort();
            if let Some(latest) = versions.last() {
                dirs.push(format!("{home}/.nvm/versions/node/{latest}/bin"));
            }
        }
    }

    // Append existing PATH so nothing is lost
    if let Ok(existing) = std::env::var("PATH") {
        dirs.push(existing);
    }

    dirs.join(":")
}

fn dev_path_dirs() -> Vec<String> {
    dev_path_env().split(':').map(|s| s.to_string()).collect()
}

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

#[tauri::command(rename_all = "camelCase")]
fn get_open_prs(owner: String, repo: String) -> Result<Vec<OpenPR>, String> {
    github::get_open_prs(&owner, &repo)
}

#[tauri::command(rename_all = "camelCase")]
fn get_pr_commits(
    owner: String,
    repo: String,
    pr_numbers: Vec<i64>,
) -> Result<std::collections::HashMap<i64, Vec<String>>, String> {
    github::get_pr_commits(&owner, &repo, &pr_numbers)
}

#[tauri::command(rename_all = "camelCase")]
fn get_branch_diff(
    repo_path: String,
    branch: String,
    base_branch: String,
    merge_commit_sha: Option<String>,
) -> Result<String, String> {
    let path = Path::new(&repo_path);
    let diff = if let Some(sha) = merge_commit_sha {
        // Historical diff: show what this PR added when it was merged
        let parent = format!("{}^1", sha);
        git::cli::run(path, &["diff", &parent, &sha, "--unified=3"])
            .map_err(|e| e.to_string())?
    } else {
        // Current diff: unmerged changes ahead of base branch
        let range = format!("{}...{}", base_branch, branch);
        git::cli::run(path, &["diff", &range, "--unified=3"])
            .map_err(|e| e.to_string())?
    };
    const MAX_CHARS: usize = 60_000;
    if diff.len() > MAX_CHARS {
        Ok(format!("{}\n\n[diff truncated at {} chars]", &diff[..MAX_CHARS], MAX_CHARS))
    } else {
        Ok(diff)
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    sha: String,
    message: String,
    author: String,
    date: String,
}

#[tauri::command(rename_all = "camelCase")]
fn get_branch_commits(
    repo_path: String,
    branch: String,
    base_branch: String,
    merge_commit_sha: Option<String>,
) -> Result<Vec<CommitInfo>, String> {
    let path = Path::new(&repo_path);
    let range = if let Some(sha) = merge_commit_sha {
        // Commits that were part of this merged PR
        format!("{}^1..{}", sha, sha)
    } else {
        // Commits on this branch not yet in base
        format!("{}..{}", base_branch, branch)
    };
    let output = git::cli::run(
        path,
        &["log", &range, "--format=%H|%h|%s|%an|%aI", "--no-merges"],
    )
    .map_err(|e| e.to_string())?;

    let commits = output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() < 5 { return None; }
            Some(CommitInfo {
                sha: parts[1].to_string(),
                message: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            })
        })
        .collect();

    Ok(commits)
}

#[tauri::command(rename_all = "camelCase")]
fn get_direct_commits(
    repo_path: String,
    branch: String,
    limit: Option<u32>,
) -> Result<Vec<DirectCommit>, String> {
    let path = Path::new(&repo_path);
    let limit = limit.unwrap_or(200);
    git::get_direct_commits(path, &branch, limit).map_err(|e| e.to_string())
}

/// Recent commits on a branch (no base filtering — just git log -N <branch>).
#[tauri::command(rename_all = "camelCase")]
fn get_recent_log(
    repo_path: String,
    branch: String,
    limit: Option<u32>,
) -> Result<Vec<CommitInfo>, String> {
    let path = Path::new(&repo_path);
    let limit_str = limit.unwrap_or(20).to_string();
    let output = git::cli::run(
        path,
        &["log", &branch, &format!("--max-count={}", limit_str), "--format=%H|%h|%s|%an|%aI", "--no-merges"],
    )
    .map_err(|e| e.to_string())?;
    let commits = output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(5, '|').collect();
            if parts.len() < 5 { return None; }
            Some(CommitInfo {
                sha: parts[1].to_string(),
                message: parts[2].to_string(),
                author: parts[3].to_string(),
                date: parts[4].to_string(),
            })
        })
        .collect();
    Ok(commits)
}

// =============================================================================
// App Preview Screenshots
// =============================================================================

/// Extract the first `http://localhost:PORT` URL from a server startup log.
/// Works for Vite ("Local: http://localhost:5175/") and
/// Next.js ("- Local: http://localhost:3000").
fn parse_localhost_url(log: &str) -> Option<String> {
    let start = log.find("localhost:")?;
    let after = &log[start + 10..]; // skip "localhost:"
    let end = after.find(|c: char| !c.is_ascii_digit()).unwrap_or(after.len());
    let port: u16 = after[..end].parse().ok()?;
    Some(format!("http://localhost:{port}"))
}

/// Normalize any naming convention to lowercase alphanumeric only, so that
/// `DesignOnboarding`, `design-onboarding`, and `design_onboarding` all compare equal.
fn normalize_name(s: &str) -> String {
    s.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

/// All page routes that exist in the repo at HEAD (used for fuzzy matching).
fn all_page_routes(repo_path: &Path) -> Vec<String> {
    let Ok(output) = git::cli::run(
        repo_path,
        &["ls-tree", "-r", "--name-only", "HEAD", "--",
          "app", "pages", "src/app", "src/pages", "src/routes"],
    ) else {
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    output
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(file_to_route)
        .filter(|r| seen.insert(r.clone()))
        .collect()
}

/// For changed files that aren't page files themselves, fuzzy-match their
/// base name against route path segments.
///
/// Example: `components/DesignOnboarding.tsx` → normalize `designonboarding`
///          → matches route `/design-onboarding` (segment normalizes the same).
fn fuzzy_matched_routes<'a>(changed_files: &[&str], all_routes: &'a [String]) -> Vec<&'a String> {
    let mut matched: Vec<&String> = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for &file in changed_files {
        if file_to_route(file).is_some() { continue; } // already handled directly

        // Build candidate names to match against route segments:
        //   (a) file stem — catches component files e.g. TarotCard.tsx → "tarotcard"
        //   (b) intermediate directory segments (skip first and last) — catches
        //       content/data/public changes e.g. content/tarot/card.md → "tarot"
        let mut names: Vec<String> = Vec::new();

        let stem = std::path::Path::new(file)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("");
        if stem.len() >= 5 {
            names.push(normalize_name(stem));
        }

        let parts: Vec<&str> = file.split('/').collect();
        // parts[0] = top-level dir (content/public/app/etc), parts[last] = filename
        // Intermediate parts are meaningful directory names that often mirror routes
        if parts.len() > 2 {
            for seg in &parts[1..parts.len() - 1] {
                if seg.len() >= 3 && !seg.starts_with('(') && !seg.starts_with('[') {
                    names.push(normalize_name(seg));
                }
            }
        }

        if names.is_empty() { continue; }

        for route in all_routes {
            if seen.contains(route.as_str()) { continue; }
            let hit = route
                .split('/')
                .filter(|s| !s.is_empty())
                .any(|seg| {
                    let norm_seg = normalize_name(seg);
                    names.iter().any(|n| {
                        norm_seg == *n
                            || (norm_seg.len() >= 8 && n.starts_with(&norm_seg))
                    })
                });
            if hit {
                seen.insert(route.as_str());
                matched.push(route);
            }
        }
    }
    matched
}

/// Debug: return raw git diff --name-only output so we can see which files changed.
#[tauri::command(rename_all = "camelCase")]
fn debug_diff_files(repo_path: String, branch: String, base_branch: String) -> String {
    let path = Path::new(&repo_path);
    let range = format!("{}...{}", base_branch, branch);
    match git::cli::run(path, &["diff", "--name-only", &range]) {
        Ok(s) => format!("OK: {:?}", s),
        Err(e) => format!("ERR: {e}"),
    }
}

/// For non-page files inside an app route directory, extract the route from
/// the first non-special path segment under `app/`.
///
/// Examples:
///   app/design-onboarding/DesignOnboardingPanel.tsx  →  /design-onboarding
///   app/design-onboarding/components/Card.tsx         →  /design-onboarding
///   app/api/users/route.ts                             →  None (api skipped)
fn app_dir_to_route(file: &str) -> Option<String> {
    if file_to_route(file).is_some() { return None; } // already a page file
    let rest = file.strip_prefix("app/")
        .or_else(|| file.strip_prefix("src/app/"))?;
    let slash_pos = rest.find('/')?; // must be inside a subdirectory
    let first_seg = &rest[..slash_pos];
    // Skip route groups, dynamic segs, parallel routes, private dirs, and api
    if first_seg.starts_with('(')
        || first_seg.starts_with('[')
        || first_seg.starts_with('@')
        || first_seg.starts_with('_')
        || first_seg == "api"
    {
        return None;
    }
    Some(format!("/{first_seg}"))
}

/// Return the URL paths most likely affected by the branch's diff.
///
/// Three-pass detection:
/// 1. Direct: changed files that ARE page files (app/**/page.tsx, pages/*.tsx).
/// 2. Directory: non-page files inside app route dirs (app/design-onboarding/X.tsx → /design-onboarding).
/// 3. Fuzzy: changed component filenames matched against all page routes in
///    the repo — e.g. `DesignOnboarding.tsx` → `/design-onboarding`.
#[tauri::command(rename_all = "camelCase")]
fn get_changed_routes(
    repo_path: String,
    branch: String,
    base_branch: String,
) -> Result<Vec<String>, String> {
    let path = Path::new(&repo_path);
    let output = git::cli::run(
        path,
        &["diff", "--name-only", &format!("{}...{}", base_branch, branch)],
    )
    .map_err(|e| e.to_string())?;

    let changed_files: Vec<&str> = output.lines().filter(|l| !l.is_empty()).collect();

    let mut seen = std::collections::HashSet::new();

    // Pass 1: direct page file matches
    let mut routes: Vec<String> = changed_files
        .iter()
        .filter_map(|f| file_to_route(f))
        .filter(|r| seen.insert(r.clone()))
        .collect();

    // Pass 2: non-page files inside app route directories → extract containing route
    for &file in &changed_files {
        if let Some(route) = app_dir_to_route(file) {
            if seen.insert(route.clone()) {
                routes.push(route);
            }
        }
    }

    // Pass 3: fuzzy-match filenames and directory segments against all repo routes.
    // This catches content/data/public changes: content/tarot/card.md → /tarot
    let all_routes = all_page_routes(path);
    for r in fuzzy_matched_routes(&changed_files, &all_routes) {
        if seen.insert(r.clone()) {
            routes.push(r.clone());
        }
    }

    // Cap at 4 routes to avoid starting excessive dev servers
    if routes.len() > 4 { routes.truncate(4); }

    Ok(routes)
}

/// Map a changed file path to a URL route, or None if not a page file.
fn file_to_route(file: &str) -> Option<String> {
    const PAGE_EXTS: &[&str] = &["page.tsx", "page.jsx", "page.ts", "page.js"];

    // Next.js App Router: app/**/page.{tsx,jsx,ts,js}  (also src/app/**)
    let app_rest = file.strip_prefix("app/")
        .or_else(|| file.strip_prefix("src/app/"));
    if let Some(rest) = app_rest {
        for &suffix in PAGE_EXTS {
            if rest == suffix {
                return Some("/".to_string());
            }
            if let Some(route_part) = rest.strip_suffix(&format!("/{suffix}")) {
                return app_route_to_url(route_part);
            }
        }
    }

    // Next.js Pages Router: pages/**/*.{tsx,jsx,ts,js}  (also src/pages/**)
    let pages_rest = file.strip_prefix("pages/")
        .or_else(|| file.strip_prefix("src/pages/"));
    if let Some(rest) = pages_rest {
        if rest.starts_with('_') || rest.starts_with("api/") {
            return None;
        }
        for &ext in &[".tsx", ".jsx", ".ts", ".js"] {
            if let Some(route) = rest.strip_suffix(ext) {
                if route == "index" {
                    return Some("/".to_string());
                }
                let route = route.strip_suffix("/index").unwrap_or(route);
                // Skip dynamic segments
                if route.contains('[') {
                    return None;
                }
                return Some(format!("/{route}"));
            }
        }
    }

    // File-based routing under src/routes/ or app/routes/ (TanStack Router, Remix, SvelteKit, etc.)
    // e.g. src/routes/design-onboarding.tsx → /design-onboarding
    let routes_rest = file
        .strip_prefix("src/routes/")
        .or_else(|| file.strip_prefix("app/routes/"));
    if let Some(rest) = routes_rest {
        // Skip special files: __root, _layout, leading underscores, api routes
        if rest.starts_with('_') || rest.starts_with("api/") || rest.starts_with("api.") {
            return None;
        }
        const EXTS: &[&str] = &[".tsx", ".jsx", ".ts", ".js", ".svelte", ".vue"];
        for &ext in EXTS {
            if let Some(route) = rest.strip_suffix(ext) {
                let route = route.strip_suffix("/index").unwrap_or(route);
                let route = route.strip_suffix("/route").unwrap_or(route);
                let route = route.strip_suffix("/page").unwrap_or(route);
                if route == "index" || route.is_empty() {
                    return Some("/".to_string());
                }
                // Skip dynamic ($param or [param]) and layout groups
                if route.contains('$') || route.contains('[') || route.contains('(') {
                    return None;
                }
                return Some(format!("/{route}"));
            }
        }
    }

    None
}

/// Convert an App Router directory path to a URL, stripping route groups
/// `(group)` and parallel routes `@slot`, skipping dynamic segments `[id]`.
fn app_route_to_url(path: &str) -> Option<String> {
    let segments: Vec<&str> = path
        .split('/')
        .filter(|s| {
            !s.starts_with('(') // route groups
                && !s.starts_with('@') // parallel routes
                && !s.starts_with('[') // dynamic segments — skip whole route
        })
        .collect();

    // If any dynamic segment was present, the original split had more parts
    if path.split('/').any(|s| s.starts_with('[')) {
        return None;
    }

    if segments.is_empty() {
        Some("/".to_string())
    } else {
        Some(format!("/{}", segments.join("/")))
    }
}

/// Screenshot a single path (convenience wrapper around `generate_preview_routes`).
#[tauri::command(rename_all = "camelCase")]
async fn generate_preview(repo_path: String, branch: String, fallback_sha: Option<String>, port: u16, path: Option<String>) -> Result<String, String> {
    let paths = vec![path.unwrap_or_else(|| "/".to_string())];
    let mut results = tauri::async_runtime::spawn_blocking(move || run_previews_blocking(repo_path, branch, fallback_sha, port, paths))
        .await
        .map_err(|e| format!("Spawn error: {e}"))??;
    results.pop().filter(|s| !s.is_empty()).ok_or_else(|| "No screenshot generated".to_string())
}

/// Screenshot multiple paths in a single server startup — one data URL per path.
/// Empty-string entries indicate a screenshot failure for that specific route.
#[tauri::command(rename_all = "camelCase")]
async fn generate_preview_routes(repo_path: String, branch: String, fallback_sha: Option<String>, port: u16, paths: Vec<String>) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || run_previews_blocking(repo_path, branch, fallback_sha, port, paths))
        .await
        .map_err(|e| format!("Spawn error: {e}"))?
}

/// Opens a visible Chrome window pointed at the branch's dev server so the user
/// can authenticate. The session is stored in `~/.git-viz-preview-auth/setup`
/// and is automatically seeded into CDP screenshot profiles on the next run.
fn run_open_browser_blocking(repo_path: String, branch: String, port: u16) -> Result<(), String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};

    let repo = Path::new(&repo_path);

    let slug: String = branch.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    let preview_dir = std::env::temp_dir().join(format!("git-viz-preview-{slug}-{port}"));

    let _ = std::fs::remove_dir_all(&preview_dir);
    std::fs::create_dir_all(&preview_dir)
        .map_err(|e| format!("Failed to create preview dir: {e}"))?;

    let archive_path = std::env::temp_dir().join(format!("git-viz-archive-{port}.tar"));
    let _ = std::fs::remove_file(&archive_path);

    let arch_out = std::process::Command::new("git")
        .args(["-C", &repo_path, "archive", "--format=tar", &branch])
        .output()
        .map_err(|e| format!("git archive failed to start: {e}"))?;

    if !arch_out.status.success() {
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err(format!(
            "git archive failed for branch '{}': {}",
            branch,
            String::from_utf8_lossy(&arch_out.stderr).trim()
        ));
    }

    std::fs::write(&archive_path, &arch_out.stdout)
        .map_err(|e| format!("Failed to write archive: {e}"))?;

    let tar_out = std::process::Command::new("tar")
        .args(["-xf", archive_path.to_str().unwrap_or(""), "-C", preview_dir.to_str().unwrap_or("")])
        .output()
        .map_err(|e| format!("tar failed to start: {e}"))?;

    let _ = std::fs::remove_file(&archive_path);

    if !tar_out.status.success() {
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err(format!(
            "tar extraction failed: {}",
            String::from_utf8_lossy(&tar_out.stderr).trim()
        ));
    }

    if !preview_dir.join("package.json").exists() {
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err("No package.json — not a Node.js project".to_string());
    }

    for name in &[
        ".env", ".env.local", ".env.development", ".env.development.local",
        ".env.production", ".env.production.local",
    ] {
        let src = repo.join(name);
        if src.exists() {
            let _ = std::fs::copy(&src, preview_dir.join(name));
        }
    }

    let pm_name = if preview_dir.join("bun.lockb").exists() { "bun" }
        else if preview_dir.join("pnpm-lock.yaml").exists() { "pnpm" }
        else if preview_dir.join("yarn.lock").exists() { "yarn" }
        else { "npm" };
    let pm = resolve_bin(pm_name);

    let main_modules = repo.join("node_modules");
    if main_modules.exists() {
        let _ = std::fs::remove_dir_all(main_modules.join(".vite"));
        let link = preview_dir.join("node_modules");
        if !link.exists() {
            let _ = std::os::unix::fs::symlink(&main_modules, &link);
        }
    }

    let port_str = port.to_string();
    let pm_args: Vec<&str> = match pm_name {
        "yarn" => vec!["dev", "--port", &port_str],
        "pnpm" => vec!["run", "dev", "--port", &port_str],
        _      => vec!["run", "dev", "--", "--port", &port_str],
    };

    let log_path = std::env::temp_dir().join(format!("git-viz-dev-{port}.log"));
    let (stdout_sink, stderr_sink) = match std::fs::File::create(&log_path) {
        Ok(f) => {
            let f2 = f.try_clone().unwrap_or_else(|_| std::fs::File::create("/dev/null").unwrap());
            (Stdio::from(f), Stdio::from(f2))
        }
        Err(_) => (Stdio::null(), Stdio::null()),
    };

    let mut server = std::process::Command::new(&pm)
        .args(&pm_args)
        .env("PORT", &port_str)
        .env("PATH", dev_path_env())
        .current_dir(&preview_dir)
        .stdout(stdout_sink)
        .stderr(stderr_sink)
        .spawn()
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(&preview_dir);
            format!("Failed to start dev server ({pm_name}): {e}")
        })?;

    let requested_url = format!("http://localhost:{port}");
    let start = Instant::now();
    let live_url: Option<String> = loop {
        if start.elapsed() > Duration::from_secs(90) { break None; }

        if let Ok(Some(_)) = server.try_wait() {
            let log = std::fs::read_to_string(&log_path).unwrap_or_default();
            let tail = log.lines().rev().take(15)
                .collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            let _ = std::fs::remove_file(&log_path);
            let _ = std::fs::remove_dir_all(&preview_dir);
            return Err(format!("Dev server crashed.\nLog:\n{tail}"));
        }

        std::thread::sleep(Duration::from_millis(500));

        if ureq::get(&requested_url).call().is_ok() {
            break Some(requested_url.clone());
        }

        let log = std::fs::read_to_string(&log_path).unwrap_or_default();
        if let Some(actual) = parse_localhost_url(&log) {
            if ureq::get(&actual).call().is_ok() {
                break Some(actual);
            }
        }
    };

    let _ = std::fs::remove_file(&log_path);

    let url = match live_url {
        Some(u) => u,
        None => {
            let _ = server.kill();
            let _ = std::fs::remove_dir_all(&preview_dir);
            return Err(format!("Dev server did not respond within 90s (tried port {port})"));
        }
    };

    let chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if !Path::new(chrome).exists() {
        let _ = server.kill();
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err("Google Chrome not found — install Chrome to generate previews".to_string());
    }

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let auth_dir = format!("{home}/.git-viz-preview-auth/setup");

    let mut chrome_proc = std::process::Command::new(chrome)
        .args([
            "--no-sandbox",
            "--disable-extensions",
            "--disable-default-apps",
            "--window-size=1440,900",
            &format!("--user-data-dir={auth_dir}"),
            &url,
        ])
        .spawn()
        .map_err(|e| {
            let _ = server.kill();
            let _ = std::fs::remove_dir_all(&preview_dir);
            format!("Failed to launch Chrome: {e}")
        })?;

    // Block until the user closes Chrome
    let _ = chrome_proc.wait();

    let _ = server.kill();
    let _ = std::fs::remove_dir_all(&preview_dir);
    Ok(())
}

/// Open a visible Chrome window for the given branch so the user can log in.
/// Returns when Chrome is closed. On the next preview run, the CDP script will
/// seed its profile from `~/.git-viz-preview-auth/setup`.
#[tauri::command(rename_all = "camelCase")]
async fn open_preview_browser(repo_path: String, branch: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || run_open_browser_blocking(repo_path, branch, 3493))
        .await
        .map_err(|e| format!("Spawn error: {e}"))?
}

/// Node.js script that uses Chrome DevTools Protocol to screenshot a URL.
///
/// Unlike `chrome --screenshot` (which fires at the browser `load` event, before
/// React's useEffect data fetches), this script waits for **network idle** — no
/// in-flight requests for 2 s — before capturing.  That means the screenshot
/// shows fully-loaded data, not loading skeletons.
///
/// Uses only Node.js built-in modules so it works without npm install.
const CDP_SCREENSHOT_SCRIPT: &str = r#"
'use strict';
const http   = require('http');
const net    = require('net');
const crypto = require('crypto');
const fs     = require('fs');
const { spawn } = require('child_process');

// urlsJson is a JSON array of full URLs to screenshot in sequence.
// Screenshots are saved as outDir/0.png, outDir/1.png, …
const [,, urlsJson, chromePath, outDir, cdpPortStr] = process.argv;
const urls = JSON.parse(urlsJson);
const CDP_PORT = parseInt(cdpPortStr, 10);

const userDataDir = require('os').tmpdir() + '/git-viz-chrome-' + CDP_PORT;
const chrome = spawn(chromePath, [
  '--headless', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
  '--window-size=1440,900', '--disable-extensions', '--disable-default-apps',
  // Allow any origin to connect via CDP (required in Chrome 112+).
  '--remote-allow-origins=*',
  `--user-data-dir=${userDataDir}`,
  `--remote-debugging-port=${CDP_PORT}`,
  'about:blank',
], { stdio: 'ignore' });
chrome.on('error', err => { process.stderr.write('Chrome error: ' + err.message + '\n'); process.exit(1); });
let chromeDead = false;
let chromeExitError = null;
chrome.on('exit', (code, signal) => {
  if (!chromeDead) {
    chromeDead = true;
    chromeExitError = new Error('Chrome exited unexpectedly (code=' + code + ', signal=' + signal + ')');
    process.stderr.write(chromeExitError.message + '\n');
  }
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function waitForTarget(timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (chromeDead) throw chromeExitError || new Error('Chrome exited before CDP was ready');
    try {
      const data = await httpGet(`http://localhost:${CDP_PORT}/json/list`);
      const targets = JSON.parse(data);
      const page = targets.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch(_) {}
    await sleep(200);
  }
  throw new Error('Timeout waiting for Chrome CDP on port ' + CDP_PORT);
}

function wsConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const { hostname: host, port, pathname, search } = new URL(wsUrl);
    const wsPath = pathname + (search || '');
    const key    = crypto.randomBytes(16).toString('base64');
    const socket = net.createConnection(parseInt(port, 10), host);

    const handlers = new Map();
    const listeners = [];
    let wsOpen = false;
    let httpBuf = Buffer.alloc(0);
    let frameBuf = Buffer.alloc(0);
    let nextId = 1;

    socket.on('connect', () => {
      socket.write([
        `GET ${wsPath} HTTP/1.1`, `Host: ${host}:${port}`,
        'Upgrade: websocket', 'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`, 'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });

    socket.on('data', chunk => {
      if (!wsOpen) {
        httpBuf = Buffer.concat([httpBuf, chunk]);
        const sep = httpBuf.indexOf('\r\n\r\n');
        if (sep !== -1) {
          const statusLine = httpBuf.slice(0, sep).toString().split('\r\n')[0];
          if (!statusLine.includes('101')) {
            return reject(new Error('WebSocket upgrade failed: ' + statusLine));
          }
          wsOpen = true;
          const rest = httpBuf.slice(sep + 4);
          if (rest.length) processFrames(rest);
          resolve(ws);
        }
        return;
      }
      processFrames(chunk);
    });

    function processFrames(data) {
      frameBuf = Buffer.concat([frameBuf, data]);
      while (frameBuf.length >= 2) {
        const opcode = frameBuf[0] & 0x0f;
        let len = frameBuf[1] & 0x7f, off = 2;
        if (len === 126) {
          if (frameBuf.length < 4) break;
          len = frameBuf.readUInt16BE(2); off = 4;
        } else if (len === 127) {
          if (frameBuf.length < 10) break;
          len = frameBuf.readUInt32BE(2) * 0x100000000 + frameBuf.readUInt32BE(6); off = 10;
        }
        if (frameBuf.length < off + len) break;
        const payload = frameBuf.slice(off, off + len);
        frameBuf = frameBuf.slice(off + len);
        if (opcode === 1) {
          try {
            const msg = JSON.parse(payload.toString());
            if (msg.id != null && handlers.has(msg.id)) {
              const h = handlers.get(msg.id); handlers.delete(msg.id);
              msg.error ? h.reject(new Error(JSON.stringify(msg.error))) : h.resolve(msg.result);
            } else if (msg.method) {
              listeners.forEach(fn => fn(msg));
            }
          } catch(_) {}
        } else if (opcode === 8) { socket.destroy(); }
      }
    }

    function sendFrame(text) {
      const payload = Buffer.from(text);
      const mask = crypto.randomBytes(4);
      let hdr;
      if (payload.length < 126) {
        hdr = Buffer.alloc(6); hdr[0] = 0x81; hdr[1] = 0x80 | payload.length; mask.copy(hdr, 2);
      } else if (payload.length < 65536) {
        hdr = Buffer.alloc(8); hdr[0] = 0x81; hdr[1] = 0xfe; hdr.writeUInt16BE(payload.length, 2); mask.copy(hdr, 4);
      } else {
        hdr = Buffer.alloc(14); hdr[0] = 0x81; hdr[1] = 0xff;
        hdr.writeUInt32BE(0, 2); hdr.writeUInt32BE(payload.length, 6); mask.copy(hdr, 10);
      }
      const masked = Buffer.allocUnsafe(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
      socket.write(Buffer.concat([hdr, masked]));
    }

    const ws = {
      send(method, params) {
        return new Promise((res, rej) => {
          if (chromeDead) { return rej(chromeExitError || new Error('Chrome is not running')); }
          const id = nextId++;
          handlers.set(id, { resolve: res, reject: rej });
          sendFrame(JSON.stringify({ id, method, params: params || {} }));
          const timeoutMs = method === 'Runtime.evaluate' ? 10000 : 30000;
          setTimeout(() => {
            if (handlers.has(id)) { handlers.delete(id); rej(new Error('CDP timeout: ' + method)); }
          }, timeoutMs);
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { socket.destroy(); } catch(_) {} },
    };

    socket.on('error', err => { if (!wsOpen) reject(err); });
    socket.on('close', () => {
      if (chromeDead) {
        const err = chromeExitError || new Error('Chrome connection closed');
        handlers.forEach(h => h.reject(err));
        handlers.clear();
      }
    });
  });
}

async function main() {
  let ws;
  try {
    const wsUrl = await waitForTarget(20000);
    ws = await wsConnect(wsUrl);

    await ws.send('Network.enable', {});
    await ws.send('Page.enable', {});
    await ws.send('Emulation.setDeviceMetricsOverride', {
      width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
    });;

    const inFlight = new Set();
    let lastActivity = Date.now();

    ws.on(msg => {
      if (msg.method === 'Network.requestWillBeSent') {
        inFlight.add(msg.params.requestId); lastActivity = Date.now();
      } else if (msg.method === 'Network.loadingFinished' || msg.method === 'Network.loadingFailed') {
        inFlight.delete(msg.params.requestId); lastActivity = Date.now();
      }
    });

    const IDLE_MS = 1000, MAX_MS = 30000;
    const { join } = require('path');

    for (let i = 0; i < urls.length; i++) {
      // Reset network tracking for each new page load
      inFlight.clear();
      lastActivity = Date.now();

      await ws.send('Page.navigate', { url: urls[i] });
      lastActivity = Date.now();

      const started = Date.now();
      while (Date.now() - started < MAX_MS) {
        if (chromeDead) throw chromeExitError || new Error('Chrome exited during page load');
        await sleep(250);
        if (inFlight.size === 0 && Date.now() - lastActivity >= IDLE_MS) break;
      }
      if (chromeDead) throw chromeExitError || new Error('Chrome exited during page load');

      // Try to click an entry-point button (e.g. "START") to reveal the main content.
      // Matches buttons/links whose full visible text is a single common CTA word.
      await sleep(400);
      const clickResult = await ws.send('Runtime.evaluate', {
        expression: `(() => {
          const re = /^\\s*(start|begin|enter|open|launch|go|continue|next|let's go|get started)\\s*$/i;
          const el = Array.from(document.querySelectorAll('button, a, [role="button"]'))
            .find(el => re.test(el.textContent));
          if (el) { el.click(); return el.textContent.trim(); }
          return null;
        })()`,
        returnByValue: true,
      });

      const didClick = clickResult && clickResult.result && clickResult.result.value != null;
      if (didClick) {
        // Wait for post-click navigation + animations to settle
        await sleep(300);
        inFlight.clear();
        lastActivity = Date.now();
        const postClick = Date.now();
        while (Date.now() - postClick < 12000) {
          if (chromeDead) throw chromeExitError || new Error('Chrome exited during page load');
          await sleep(250);
          if (inFlight.size === 0 && Date.now() - lastActivity >= IDLE_MS) break;
        }
        await sleep(1200);
      }

      const shot = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      if (!shot || !shot.data) throw new Error('No screenshot data for URL ' + i);

      fs.writeFileSync(join(outDir, i + '.png'), Buffer.from(shot.data, 'base64'));
    }

    ws.close(); chrome.kill(); process.exit(0);
  } catch(err) {
    process.stderr.write('Error: ' + err.message + '\n');
    if (ws) try { ws.close(); } catch(_) {}
    chrome.kill(); process.exit(1);
  }
}
main();
"#;

/// Recursively copy `src` dir into `dst`, skipping symlinks (e.g. Chrome's
/// SingletonLock) and known large cache directories that aren't needed for
/// preserving web-app session state.
fn copy_dir_all(src: &Path, dst: &Path) -> std::io::Result<()> {
    const SKIP: &[&str] = &[
        "Cache", "Code Cache", "GPUCache", "ShaderCache", "Crashpad",
        "CrashpadMetrics-active.pma", "BrowserMetrics", "GrShaderCache",
    ];
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let name = entry.file_name();
        if SKIP.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let ty = entry.file_type()?;
        if ty.is_dir() {
            let _ = copy_dir_all(&entry.path(), &dst.join(&name));
        } else if ty.is_file() {
            // ty.is_symlink() is false here because is_file() is false for symlinks
            let _ = std::fs::copy(entry.path(), dst.join(&name));
        }
        // Symlinks (SingletonLock, etc.) are skipped — is_dir and is_file both false
    }
    Ok(())
}

/// Returns true if the project at `dir` uses hash-based client-side routing
/// (React HashRouter, Vue createWebHashHistory, etc.). For these apps all paths
/// serve the same HTML — routes live in the URL fragment, e.g. `/#/tarot`.
fn uses_hash_routing(dir: &Path) -> bool {
    const PATTERNS: &[&str] = &[
        "createHashRouter",
        "HashRouter",
        "createHashHistory",
        "createWebHashHistory",  // Vue Router
        "useHash: true",
        "\"hash\"",              // generic router hash mode config
        "'hash'",
    ];
    let candidates = [
        "src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js",
        "src/App.tsx",  "src/App.ts",  "src/App.jsx",  "src/App.js",
        "src/router.ts", "src/router.tsx", "src/router/index.ts", "src/router/index.tsx",
        "src/routes.ts", "src/routes.tsx",
        "app/router.ts", "app/router.tsx",
    ];
    for rel in &candidates {
        if let Ok(content) = std::fs::read_to_string(dir.join(rel)) {
            if PATTERNS.iter().any(|p| content.contains(p)) {
                return true;
            }
        }
    }
    false
}

/// Blocking core: starts a dev server for `branch`, screenshots each `path` in
/// sequence via the CDP script, and returns one base64 data URL per path.
/// Empty strings indicate that a particular screenshot failed.
fn run_previews_blocking(repo_path: String, branch: String, fallback_sha: Option<String>, port: u16, paths: Vec<String>) -> Result<Vec<String>, String> {
    use std::process::Stdio;
    use std::time::{Duration, Instant};
    use base64::Engine;

    let repo = Path::new(&repo_path);

    // Sanitise branch name for the temp directory name
    let slug: String = branch.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect();
    // Include port in the dir name so concurrent calls for the same branch
    // (e.g. from React StrictMode double-effect) use separate directories.
    let preview_dir = std::env::temp_dir().join(format!("git-viz-preview-{slug}-{port}"));

    // Always start clean
    let _ = std::fs::remove_dir_all(&preview_dir);
    std::fs::create_dir_all(&preview_dir)
        .map_err(|e| format!("Failed to create preview dir: {e}"))?;

    // ── Extract branch files via git archive ─────────────────────────────────
    // More reliable than git worktrees (no locking, no registration state).
    // We buffer to a temp .tar file instead of piping, avoiding macOS pipe
    // edge cases where tar can exit before git flushes its stdout.
    let archive_path = std::env::temp_dir().join(format!("git-viz-archive-{port}.tar"));
    let _ = std::fs::remove_file(&archive_path);

    let primary = std::process::Command::new("git")
        .args(["-C", &repo_path, "archive", "--format=tar", &branch])
        .output()
        .map_err(|e| format!("git archive failed to start: {e}"))?;

    let arch_out = if primary.status.success() {
        primary
    } else if let Some(ref sha) = fallback_sha {
        let fallback = std::process::Command::new("git")
            .args(["-C", &repo_path, "archive", "--format=tar", sha])
            .output()
            .map_err(|e| format!("git archive failed to start: {e}"))?;
        if fallback.status.success() {
            fallback
        } else {
            let _ = std::fs::remove_dir_all(&preview_dir);
            return Err(format!(
                "git archive failed for branch '{}': {}",
                branch,
                String::from_utf8_lossy(&primary.stderr).trim()
            ));
        }
    } else {
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err(format!(
            "git archive failed for branch '{}': {}",
            branch,
            String::from_utf8_lossy(&primary.stderr).trim()
        ));
    };

    std::fs::write(&archive_path, &arch_out.stdout)
        .map_err(|e| format!("Failed to write archive: {e}"))?;

    let tar_out = std::process::Command::new("tar")
        .args(["-xf", archive_path.to_str().unwrap_or(""), "-C", preview_dir.to_str().unwrap_or("")])
        .output()
        .map_err(|e| format!("tar failed to start: {e}"))?;

    let _ = std::fs::remove_file(&archive_path);

    if !tar_out.status.success() {
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err(format!(
            "tar extraction failed: {}",
            String::from_utf8_lossy(&tar_out.stderr).trim()
        ));
    }

    // Must be a Node.js project
    if !preview_dir.join("package.json").exists() {
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err("No package.json — not a Node.js project".to_string());
    }

    // Copy .env files from the real repo into the temp dir.
    // git archive excludes them (they're gitignored) but the app needs them
    // to authenticate and load data — without them the app shows loading
    // skeletons or blank pages indefinitely.
    for name in &[
        ".env",
        ".env.local",
        ".env.development",
        ".env.development.local",
        ".env.production",
        ".env.production.local",
    ] {
        let src = repo.join(name);
        if src.exists() {
            let _ = std::fs::copy(&src, preview_dir.join(name));
        }
    }

    // Inject a MutationObserver script into index.html that removes the
    // Vite error overlay element before the screenshot is taken.
    // We're modifying a temp copy so the real repo is untouched.
    let index_html_path = preview_dir.join("index.html");
    if index_html_path.exists() {
        if let Ok(html) = std::fs::read_to_string(&index_html_path) {
            let inject = concat!(
                "<script>",
                "!function(){",
                "var mo=new MutationObserver(function(){",
                "var el=document.querySelector('vite-error-overlay');",
                "if(el)el.remove();",
                "});",
                "document.addEventListener('DOMContentLoaded',function(){",
                "if(document.body)mo.observe(document.body,{childList:true,subtree:true});",
                "});",
                "}();",
                "</script>"
            );
            let patched = if html.contains("</body>") {
                html.replace("</body>", &format!("{inject}</body>"))
            } else {
                format!("{html}{inject}")
            };
            let _ = std::fs::write(&index_html_path, patched);
        }
    }

    // Detect package manager from lockfile
    let pm_name = if preview_dir.join("bun.lockb").exists() { "bun" }
        else if preview_dir.join("pnpm-lock.yaml").exists() { "pnpm" }
        else if preview_dir.join("yarn.lock").exists() { "yarn" }
        else { "npm" };
    let pm = resolve_bin(pm_name);

    // Symlink node_modules from the live repo checkout to skip install
    let main_modules = repo.join("node_modules");
    if main_modules.exists() {
        let link = preview_dir.join("node_modules");
        if !link.exists() {
            let _ = std::os::unix::fs::symlink(&main_modules, &link);
        }
    }

    // Restore persisted .next cache for warm server startup.
    // The cache is keyed by branch slug so different branches don't share state.
    // If a cache exists from a prior run, symlink it in — Next.js writes directly
    // into it, keeping it up to date without any post-run copy step.
    let next_cache = std::env::temp_dir().join(format!("git-viz-next-cache-{slug}"));
    let next_link = preview_dir.join(".next");
    if next_cache.exists() {
        let _ = std::os::unix::fs::symlink(&next_cache, &next_link);
    }

    // Launch dev server (PORT env var + --port flag for belt-and-suspenders)
    let port_str = port.to_string();
    // npm and bun strip '--' before forwarding to the script.
    // pnpm does NOT — it passes '--' literally, so 'pnpm run dev -- --port X'
    // becomes 'vite -- --port X' which vite ignores.  Omit '--' for pnpm.
    let pm_args: Vec<&str> = match pm_name {
        "yarn" => vec!["dev", "--port", &port_str],
        "pnpm" => vec!["run", "dev", "--port", &port_str],
        _      => vec!["run", "dev", "--", "--port", &port_str],
    };

    // Capture BOTH stdout and stderr to a log file.
    // Next.js writes its "ready on port X" message to stdout, not stderr.
    let log_path = std::env::temp_dir().join(format!("git-viz-dev-{port}.log"));
    let (stdout_sink, stderr_sink) = match std::fs::File::create(&log_path) {
        Ok(f) => {
            let f2 = f.try_clone().unwrap_or_else(|_| std::fs::File::create("/dev/null").unwrap());
            (Stdio::from(f), Stdio::from(f2))
        }
        Err(_) => (Stdio::null(), Stdio::null()),
    };

    let mut server = std::process::Command::new(&pm)
        .args(&pm_args)
        .env("PORT", &port_str)
        .env("PATH", dev_path_env())
        .current_dir(&preview_dir)
        .stdout(stdout_sink)
        .stderr(stderr_sink)
        .spawn()
        .map_err(|e| {
            let _ = std::fs::remove_dir_all(&preview_dir);
            format!("Failed to start dev server ({pm_name}): {e}")
        })?;

    // Poll until the server responds.  We try two URLs:
    // 1. The port we asked for (via --port flag).
    // 2. Whatever port the server actually logged (fallback for frameworks that
    //    ignore --port or choose a different port due to conflicts).
    let requested_url = format!("http://localhost:{port}");
    let start = Instant::now();
    let live_url: Option<String> = loop {
        if start.elapsed() > Duration::from_secs(90) { break None; }

        // Bail early on crash rather than waiting the full 90s
        if let Ok(Some(_)) = server.try_wait() {
            let log = std::fs::read_to_string(&log_path).unwrap_or_default();
            let tail = log.lines().rev().take(15)
                .collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            let _ = std::fs::remove_file(&log_path);
            let _ = std::fs::remove_dir_all(&preview_dir);
            return Err(format!("Dev server crashed.\nLog:\n{tail}"));
        }

        std::thread::sleep(Duration::from_millis(200));

        // 1. Check the port we asked for
        if ureq::get(&requested_url).call().is_ok() {
            break Some(requested_url.clone());
        }

        // 2. Parse the log to find what port the server actually chose
        //    (e.g. Vite prints "Local: http://localhost:5175/")
        let log = std::fs::read_to_string(&log_path).unwrap_or_default();
        if let Some(actual) = parse_localhost_url(&log) {
            if ureq::get(&actual).call().is_ok() {
                break Some(actual);
            }
        }
    };

    let url = match live_url {
        Some(u) => u,
        None => {
            let _ = server.kill();
            let log = std::fs::read_to_string(&log_path).unwrap_or_default();
            let tail = log.lines().rev().take(15)
                .collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            let _ = std::fs::remove_file(&log_path);
            let _ = std::fs::remove_dir_all(&preview_dir);
            return Err(if tail.is_empty() {
                format!("Dev server did not respond within 90s (tried port {port})")
            } else {
                format!("Dev server timed out. Last log output:\n{tail}")
            });
        }
    };
    let _ = std::fs::remove_file(&log_path);

    // Locate Chrome
    let chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
    if !Path::new(chrome).exists() {
        let _ = server.kill();
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err("Google Chrome not found — install Chrome to generate previews".to_string());
    }

    // Locate Node.js — check common macOS install paths
    let node_bin = [
        "node",
        "/usr/local/bin/node",
        "/opt/homebrew/bin/node",
        "/usr/bin/node",
    ]
    .iter()
    .find(|&&n| {
        if n.starts_with('/') {
            Path::new(n).exists()
        } else {
            std::process::Command::new(n)
                .arg("--version")
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
        }
    })
    .copied();

    if node_bin.is_none() {
        let _ = server.kill();
        let _ = std::fs::remove_dir_all(&preview_dir);
        return Err("Node.js not found — install Node.js to generate previews".to_string());
    }
    let node_bin = node_bin.unwrap();

    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let cdp_port_num = port + 1000;

    // Use a fresh temp dir for each Chrome instance — guarantees no stale
    // SingletonLock/SingletonCookie symlinks from previous crashed sessions.
    let temp_profile = std::env::temp_dir().join(format!("git-viz-chrome-{cdp_port_num}"));
    let _ = std::fs::remove_dir_all(&temp_profile);

    // Copy the full auth session profile (cookies, localStorage, IndexedDB, etc.)
    // so logged-in state carries over. copy_dir_all skips symlinks automatically,
    // so SingletonLock is never transferred to the fresh temp dir.
    let shared_auth = Path::new(&home).join(".git-viz-preview-auth/setup");
    if shared_auth.exists() {
        let _ = copy_dir_all(&shared_auth, &temp_profile);
    } else {
        let _ = std::fs::create_dir_all(&temp_profile);
    }

    // Detect hash-based routing (e.g. React Router HashRouter, Vue createWebHashHistory).
    // These apps serve the same HTML at every path; routes live in the URL fragment (#/tarot).
    let hash_routing = uses_hash_routing(&preview_dir);

    // Build the full URL for each requested path.
    let nav_paths = if paths.is_empty() { vec!["/".to_string()] } else { paths };
    let full_urls: Vec<String> = nav_paths.iter().map(|p| {
        let p = if p.starts_with('/') { p.as_str() } else { "/" };
        if p == "/" {
            url.clone()
        } else if hash_routing {
            format!("{url}/#{p}")   // e.g. http://localhost:3492/#/tarot
        } else {
            format!("{url}{p}")     // e.g. http://localhost:3492/tarot
        }
    }).collect();

    let urls_json = serde_json::to_string(&full_urls)
        .map_err(|e| format!("JSON error: {e}"))?;

    // Output directory: one PNG per path (0.png, 1.png, …)
    let out_dir = std::env::temp_dir().join(format!("git-viz-shots-{port}"));
    let _ = std::fs::remove_dir_all(&out_dir);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Failed to create output dir: {e}"))?;

    // Write CDP script and invoke it.
    // The script starts Chrome with --remote-debugging-port, navigates to each
    // URL in sequence, waits for network idle (2 s quiet), then screenshots.
    let script_path = std::env::temp_dir().join(format!("git-viz-cdp-{port}.js"));
    std::fs::write(&script_path, CDP_SCREENSHOT_SCRIPT)
        .map_err(|e| format!("Failed to write CDP script: {e}"))?;

    // CDP debug port offset: 3491 → 4491, 3492 → 4492
    let cdp_port = (port + 1000).to_string();

    let node_out = std::process::Command::new(node_bin)
        .args([
            script_path.to_str().unwrap_or(""),
            &urls_json,
            chrome,
            out_dir.to_str().unwrap_or(""),
            &cdp_port,
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .output();

    let _ = std::fs::remove_file(&script_path);
    let _ = server.kill();

    // Persist the .next cache for warm startup on subsequent runs.
    // Only move if it's a real directory (first run); if it's already a symlink
    // pointing at next_cache, the cache was updated in-place — nothing to do.
    if next_link.exists() && !next_link.is_symlink() {
        let _ = std::fs::remove_dir_all(&next_cache);
        let _ = std::fs::rename(&next_link, &next_cache);
    }

    let _ = std::fs::remove_dir_all(&preview_dir);

    match node_out {
        Ok(out) => {
            let mut results: Vec<String> = Vec::with_capacity(full_urls.len());
            for i in 0..full_urls.len() {
                let png = out_dir.join(format!("{i}.png"));
                if png.exists() {
                    match std::fs::read(&png) {
                        Ok(bytes) if !bytes.is_empty() => {
                            let _ = std::fs::remove_file(&png);
                            results.push(format!(
                                "data:image/png;base64,{}",
                                base64::engine::general_purpose::STANDARD.encode(&bytes)
                            ));
                        }
                        Ok(_) => results.push(String::new()), // 0-byte = skip
                        Err(_) => results.push(String::new()),
                    }
                } else {
                    results.push(String::new());
                }
            }
            let _ = std::fs::remove_dir_all(&out_dir);
            if results.iter().all(|s| s.is_empty()) {
                let stderr = String::from_utf8_lossy(&out.stderr);
                Err(format!("Screenshot failed: {}", stderr.trim()))
            } else {
                Ok(results)
            }
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&out_dir);
            Err(format!("Node.js launch failed: {e}"))
        }
    }
}

/// Capture the main webview window and save as a PNG.
/// Uses macOS `screencapture -R x,y,w,h` with the window's exact bounds.
#[tauri::command]
fn screenshot(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let win = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let pos = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let region = format!("{},{},{},{}", pos.x, pos.y, size.width, size.height);
    std::process::Command::new("screencapture")
        .args(["-x", "-R", &region, &path]) // -x = silent, -R = region
        .status()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn summarize_diff(diff: String, api_key: String) -> Result<String, String> {
    let prompt = format!(
        "Analyze this git diff and return a plain-English summary grouped by area of the codebase.\n\n\
         Return ONLY valid JSON, no markdown fences:\n\
         [\n  {{\n    \"section\": \"Area or component name\",\n    \"changes\": [\n      \
         {{\"type\": \"add\", \"description\": \"What was added or improved\"}},\n      \
         {{\"type\": \"remove\", \"description\": \"What was removed or changed\"}}\n    ]\n  }}\n]\n\n\
         Rules:\n\
         - Group by feature area, not by file\n\
         - Keep descriptions under 55 chars\n\
         - Use \"add\" for additions/improvements, \"remove\" for removals/regressions\n\
         - Max 6 sections, max 4 changes per section\n\n\
         Git diff:\n{}",
        diff
    );
    let body = serde_json::json!({
        "model": "claude-haiku-4-5-20251001",
        "max_tokens": 1024,
        "messages": [{ "role": "user", "content": prompt }]
    });
    let result = ureq::post("https://api.anthropic.com/v1/messages")
        .set("Content-Type", "application/json")
        .set("x-api-key", &api_key)
        .set("anthropic-version", "2023-06-01")
        .send_json(&body);
    match result {
        Ok(resp) => {
            let data: serde_json::Value = resp
                .into_json()
                .map_err(|e| format!("Failed to parse response: {e}"))?;
            Ok(data["content"][0]["text"].as_str().unwrap_or("").to_string())
        }
        Err(ureq::Error::Status(code, resp)) => {
            let body: serde_json::Value = resp.into_json().unwrap_or_default();
            let msg = body["error"]["message"].as_str().unwrap_or("Unknown error");
            Err(format!("{code}: {msg}"))
        }
        Err(e) => Err(format!("Network error: {e}")),
    }
}

#[tauri::command]
fn get_anthropic_key() -> Option<String> {
    // Compile-time key (set ANTHROPIC_API_KEY when running pnpm tauri build)
    if let Some(key) = option_env!("ANTHROPIC_API_KEY") {
        if !key.is_empty() {
            return Some(key.to_string());
        }
    }
    // Fallback to runtime env var for local development
    std::env::var("ANTHROPIC_API_KEY").ok()
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
            get_open_prs,
            get_pr_commits,
            list_directory,
            search_directories,
            get_home_dir,
            get_branch_diff,
            get_branch_commits,
            get_direct_commits,
            get_anthropic_key,
            summarize_diff,
            screenshot,
            get_recent_log,
            generate_preview,
            generate_preview_routes,
            open_preview_browser,
            get_changed_routes,
            debug_diff_files,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
