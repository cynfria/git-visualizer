# git-visualizer — Project Rules

## Stack
- Next.js 16 App Router, TypeScript, Tailwind CSS
- SVG-based branch map canvas (custom, no React Flow)
- GitHub REST API v3 via server components + API routes
- `GITHUB_PAT` env var for authentication

## Key Files
- `components/BranchMap.tsx` — main SVG canvas, all layout constants at top
- `lib/github.ts` — all GitHub API wrappers
- `types/index.ts` — shared TypeScript types
- `app/repo/[owner]/[repo]/page.tsx` — server component, initial data fetch
- `app/api/commits/route.ts` — paginated commit history API route
- `app/globals.css` — global styles including custom scrollbar

## Design System — BossUI Principles

This project follows the BossUI standard: **refined minimalism with subtle depth**. Clean surfaces, purposeful shadows, smooth transitions. Not sterile, not flashy.

### Color Tokens — NEVER hardcode colors

Use CSS variables and Tailwind design tokens exclusively:

```
bg-background        /* base app background */
bg-card              /* elevated surfaces, panels */
bg-muted             /* subtle differentiation, hover states */
bg-muted/30          /* very subtle backgrounds */
bg-primary/10        /* selection/active states */
text-foreground      /* primary text */
text-muted-foreground /* secondary, labels, timestamps */
border-border        /* standard borders */
border-border/50     /* subtle borders */
hover:bg-accent
hover:bg-muted
```

**NEVER** use `bg-white`, `bg-gray-100`, `text-gray-500`, `border-gray-200`, or any other hardcoded color. Always use tokens that respect dark/light mode.

Exception: the SVG canvas uses raw hex values for geometry (stroke colors, fill) because SVG doesn't support Tailwind classes — this is acceptable.

### Status Colors

Always include dark mode variants:
```
/* Success */   bg-green-50 dark:bg-green-900/20  text-green-600 dark:text-green-400
/* Warning */   bg-amber-50 dark:bg-amber-900/20  text-amber-600 dark:text-amber-400
/* Error */     bg-red-50 dark:bg-red-900/20      text-red-600 dark:text-red-400
/* Info */      bg-blue-50 dark:bg-blue-900/20    text-blue-600 dark:text-blue-400
```

### Typography
- Page titles: `text-lg font-semibold`
- Section headers: `text-sm font-medium`
- Body: `text-sm`
- Metadata/labels: `text-xs`
- Section labels: `text-[10px] uppercase tracking-wide text-muted-foreground font-medium`

### Spacing & Shape
- Page padding: `max-w-7xl mx-auto px-6 pt-6`
- Card padding: `p-4` or `px-4 py-2.5` for compact items
- Gaps: `gap-4` for grids, `gap-2` for tight lists
- Border radius: `rounded-2xl` for major containers, `rounded-xl` for cards, `rounded-lg` for buttons/inputs

### Shadows — use sparingly
```
shadow-sm      /* subtle elevation — inputs, floating buttons */
shadow-inner   /* inset depth — empty states */
shadow-lg      /* modals, dropdowns */
```

Glassmorphism for overlays: `bg-card/80 backdrop-blur-sm rounded-2xl border shadow-sm`

### Motion
- Sidebar/panel collapse: `transition-all duration-300 ease-in-out`
- Hover states: `transition-colors`
- Never jarring — smooth width/opacity changes only

### Component Patterns

**Cards/tiles:**
```tsx
<div className="rounded-xl border p-4 bg-card hover:shadow-sm transition-colors cursor-pointer">
```

**Empty states:**
```tsx
<div className="h-full bg-muted/30 shadow-inner rounded-xl flex items-center justify-center">
  <div className="text-center">
    <p className="text-sm text-muted-foreground">Message here</p>
  </div>
</div>
```

**Nav items:**
```tsx
<div className={cn(
  'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
  isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent'
)}>
```

## Workflow Rules
- Do NOT auto-commit — only commit when explicitly asked
- Do NOT open or refresh the browser
- Always use `cn()` for conditional class merging
- Use `shrink-0` on icons to prevent squishing
- Include hover/active states on all interactive elements
- No emojis in UI unless explicitly requested

## Anti-Patterns
- No hardcoded colors anywhere in TSX/CSS (SVG geometry is the only exception)
- No inconsistent border radii within the same context
- No shadows without purpose
- No new patterns when existing ones apply
- No mixing button/input styles within the same view
