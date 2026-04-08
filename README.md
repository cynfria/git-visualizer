# Git Visualizer

A desktop app for visualizing a local git repository's branch timeline, open/merged PRs, commit history, AI-powered diff summaries, and screenshot previews of any branch.

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

1. **Clone the repo**
   ```bash
   git clone <repo-url>
   cd git-visualizer
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set your GitHub token**

   Create a `.env` file in the project root:
   ```
   GITHUB_PAT=ghp_your_token_here
   ```

---

## Running the app

```bash
pnpm tauri dev
```

This starts the Vite dev server and the Tauri desktop window together. The first run will compile the Rust backend, which takes a few minutes.

---

## Building for production

```bash
pnpm tauri build
```

The compiled app bundle will be in `src-tauri/target/release/bundle/`.

---

## What it does

- **Branch timeline** — SVG canvas showing all branches, merges, and direct commits over time
- **PR panel** — open and merged pull requests fetched from GitHub, linked to branches on the map
- **Commit history** — paginated commit log per branch
- **AI diff summaries** — summarizes the diff for any branch using an LLM
- **Screenshot previews** — spins up the branch locally and captures a screenshot via headless Chrome
