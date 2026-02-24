mod cli;
mod branches;
mod commits;

pub use cli::GitError;
pub use branches::{Branch, get_default_branch, get_repo_info, list_branches};
pub use commits::{MergeNode, get_merge_commits};
