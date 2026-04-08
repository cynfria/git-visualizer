# Git Visualizer

  <img width="1678" height="1080" alt="git-viz-screenshot" src="https://github.com/user-attachments/assets/a0ef1dbb-85ed-4544-ba58-3513a7d3f6d9" />
  <img width="1678" height="1080" alt="git-viz-screenshot-2" src="https://github.com/user-attachments/assets/505d305c-be0f-424f-8bb6-78e14e6a87df" />
  <img width="1678" height="1080" alt="git-viz-screenshot-3" src="https://github.com/user-attachments/assets/26b1050d-d1bb-4005-ab45-8c6a0c3f3fcf" />

  A desktop app for visualizing a local git repository's branch timeline, open/merged PRs, commit
  history, AI-powered diff summaries, and screenshot previews of any branch.

  Built with Tauri 2 (Rust backend) + React + Vite + Tailwind CSS.

  ---

  ## Prerequisites

  - [Node.js](https://nodejs.org/) 18+
  - [pnpm](https://pnpm.io/) (`npm install -g pnpm`)
  - [Rust](https://www.rust-lang.org/tools/install) (stable toolchain)
  - [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform
  - A GitHub personal access token (PAT) with `repo` scope

  ---

  ## Setup

  1. Clone the repo
     ```bash
     git clone <repo-url>
     cd git-visualizer

  2. Install dependencies
  pnpm install
  3. Set your GitHub token

  3. Create a .env file in the project root:
  GITHUB_PAT=ghp_your_token_here

  ---
  **Running the app**

  pnpm tauri dev

  This starts the Vite dev server and the Tauri desktop window together. The first run will compile
   the Rust backend, which takes a few minutes.

  ---
 ** Building for production**

  pnpm tauri build

  The compiled app bundle will be in src-tauri/target/release/bundle/.

  ---
  **What it does**

  - Branch timeline — SVG canvas showing all branches, merges, and direct commits over time
  - PR panel — open and merged pull requests fetched from GitHub, linked to branches on the map
  - Commit history — paginated commit log per branch
  - AI diff summaries — summarizes the diff for any branch using an LLM
  - Screenshot previews — spins up the branch locally and captures a screenshot via headless Chrome


