# auth-6b — Admin Console UI (AdminPage)

## Task
Built the in-app Admin Console page for EmorTrades (Next.js 16, App Router, dark theme).
Single file created, nothing else touched (no registry/routing wiring — parent handles mounting).

## File created
`src/components/pages/admin/admin-page.tsx` — exports `AdminPage()` (`'use client'`).
Mounted inside the app shell's `<main>`; contributes only a `space-y-6` stack (no page padding wrapper, no nav/footer).

## Component structure
- **AdminPage** — header ("Admin Console" + subtitle, emerald ShieldCheck chip) → `StatsSection` → `UsersSection`.
- **StatsSection** — `useQuery(['admin-stats'])` → GET `/api/admin/stats`. 5 `StatCard`s (Total users "+N new this week", Active users "N suspended", Admins, Trades journaled, AI reports). Loading: 5 `Skeleton` tiles. Error: `ErrorTile` + refetch retry. Grid: `grid-cols-2` (390px) → `md:grid-cols-3` → `xl:grid-cols-5`. Default window-focus refetch kept.
- **UsersSection** — `useQuery(['admin-users'])` → GET `/api/admin/users`. Three `useMutation`s (PATCH role/status, DELETE, POST reset-password); every success/error surfaces the API's `message` via `sonner` toast and invalidates `['admin-users']` + `['admin-stats']`.
  - Search Input (name/email, client-side filter, clear button) with live count (`aria-live`).
  - Table (`@/components/ui/table`): User (initials avatar + name/email stacked), Role (Admin = emerald / User = slate badges), Status (Active = emerald dot / Suspended = red dot), Trades, Plans (right-aligned tabular-nums), Joined (`formatDate` from `@/lib/format`), Last login (relative `timeAgoLabel`, "Never" when null), Actions (MoreHorizontal dropdown).
  - Container: `max-h-[520px] overflow-auto rounded-lg border border-slate-800 bg-card`; sticky header via `[&_th]:sticky [&_th]:top-0 [&_th]:bg-card` + `[&_[data-slot=table-container]]:overflow-visible` (neutralizes shadcn Table's inner `overflow-x-auto` so the outer div is the single scrollport — sticky works). Table `min-w-[880px]` → horizontal scroll on mobile (chosen over card-list).
  - Menu: Promote/Demote (UserCog / ShieldCheck-emerald), Suspend (Ban-amber)/Reactivate (PlayCircle-emerald), Reset password… (KeyRound), Delete user… (Trash2, red). Per-row pending: `mutation.isPending && variables.id === row.id` → Loader2 spinner in the menu item + other items disabled.
- **ResetPasswordDialog** — controlled Dialog; password draft owned by parent (`resetPwd`) so it clears per target (avoids setState-in-effect lint rule). Input (font-mono, maxLength 200, `aria-describedby` hint) + "Generate" button (crypto-random, unambiguous charset, 16 chars). Submit disabled < 8 chars; pending spinner; closes via per-call `onSuccess`.
- **DeleteUserDialog** — AlertDialog with name + email + the mandated warning ("This permanently deletes the user and ALL their trades, journals, plans and settings"). AlertDialogAction uses `e.preventDefault()` so the dialog stays open with a spinner during flight (radix respects defaultPrevented), closing on success.
- **SkeletonRows** (6 placeholder rows) / **EmptyRow** (distinct copy for no-users vs no-search-matches + Clear search) / **ErrorTile** (role=alert + Try again).

## Data contracts consumed (read from source, unchanged)
- GET `/api/admin/users` → `{ users: [...] }` (newest first)
- GET `/api/admin/stats` → `{ stats: {...} }`
- PATCH/DELETE `/api/admin/users/[id]` (guards: self-modification, last-admin → 400 with `message`)
- POST `/api/admin/users/[id]/reset-password` (400 if < 8 chars)

## Design compliance
Dark theme: `bg-card` / `border-slate-800` / slate-800 secondary surfaces; emerald ONLY for primary actions, admin/active badges, promote/reactivate icons; red for destructive; amber for suspend. No indigo/blue. lucide-react icons only, no emojis. Keyboard accessible (radix DropdownMenu/Dialog/AlertDialog); destructive action gated behind AlertDialog.

## Verification
- `bunx tsc --noEmit` → 0 errors (no output)
- `bun run lint` → exit 0, clean
- No dev server started; no other files modified (`git status`: only `?? src/components/pages/admin/`); not added to any page registry.

## Notes for downstream agents
- Sticky table header depends on the `[&_[data-slot=table-container]]:overflow-visible` override — keep it if refactoring.
- UI does not know the current admin's identity (no client session hook exists app-wide); backend guards self/last-admin and the UI surfaces those `message`s as error toasts — by design.
- `sonner` is globally mounted in `src/app/layout.tsx` (`<SonnerToaster />`), so toasts render without any wrapper here.
