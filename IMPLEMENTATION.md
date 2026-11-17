# Implementation breakdown and PRP comparison

The repository started with documentation and an empty npm lockfile, with no application source. The implementation follows `PRPs/00-one-shot-implementation.md` as the controlling specification and compares the acceptance criteria in PRPs 01–11.

## Feature map

| PRP | Implemented behavior | Main source | Verification |
| --- | --- | --- | --- |
| 01 · Todo CRUD | Create, edit, toggle, delete; optimistic changes with rollback; overdue/pending/completed sections; priority/date/newest sorting; future-date validation; ownership checks and cascades | `app/page.tsx`, `lib/db.ts`, `app/api/todos/` | `02-todo-crud`, `04-due-dates`, domain/database tests |
| 02 · Priorities | High/medium/low; medium default; validated enums; accessible light/dark badges; sorting and combined filtering | `lib/validation.ts`, `lib/todos.ts`, `app/globals.css` | `03-priority`, domain tests |
| 03 · Recurrence | Daily/weekly/monthly/yearly; month/leap-year clamping; metadata, tags and reset subtasks inherited; one successor per source, even after reopening | `lib/timezone.ts`, `lib/db.ts` | `05-recurring-todos`, domain/database tests |
| 04 · Reminders | Seven presets; permission control; 30-second polling; due-window filtering; atomic claim to suppress concurrent duplicates; editing timing rearms | `lib/hooks/useNotifications.ts`, notifications API | `06-reminders`, database tests |
| 05 · Subtasks | Add/edit/toggle/delete; append positions; independent completion; rounded progress; green at 100%; hidden at zero; remains visible when collapsed | `app/page.tsx`, `lib/db.ts`, subtasks APIs | `07-subtasks`, domain/database tests |
| 06 · Tags | Create/edit/delete, custom colors, multiple tags, idempotent attach/detach, case-insensitive per-user uniqueness, filter, cascade removal | `app/page.tsx`, tag APIs, `lib/db.ts` | `08-tags`, database tests |
| 07 · Templates | Save tasks with subtask titles/positions, categories, settings and relative due offsets; manage/edit/use/delete; tags excluded; independent generated tasks | `app/page.tsx`, template APIs | `09-templates`, database tests |
| 08 · Search/filter | Title and subtask search; 300ms debounce; ordered AND filtering; independent date bounds; completion/priority/tag controls; local saved presets with corrupt-data fallback | `lib/todos.ts`, `app/page.tsx` | `10-search-filtering`, domain/performance tests |
| 09 · Export/import | Versioned nested JSON backup; CSV download with escaped fields; validated, transactional append import; fresh IDs; existing case-insensitive tags reused; import success count | export/import APIs, `lib/db.ts`, `lib/validation.ts` | `11-export-import`, database/domain tests |
| 10 · Calendar | Protected month view; URL navigation; full adjacent-month weeks; today/past/weekend flags; priority pills; three-item overflow; day dialog; holiday labels; seed script | `app/calendar/page.tsx`, `lib/timezone.ts`, `scripts/seed-holidays.ts` | `12-calendar`, domain tests |
| 11 · Passkeys | Registration/login verification; HTTP-only signed seven-day sessions; logout; protected routes; duplicate-user rejection; authenticated additional passkeys; one-use five-minute challenges; counter checking | `lib/webauthn.ts`, `lib/session.ts`, `lib/auth.ts`, `middleware.ts` | `01-authentication`, session/database tests |

## Build stages

1. Foundation: Next.js 16, React 19, Tailwind 4, TypeScript, SQLite schema, shared types, Singapore time helpers, sessions and passkeys.
2. Core behavior: todo APIs/UI, priority sorting, recurrence, reminders and subtask progress.
3. Organization: tags, templates, search, combined filters and browser-persisted presets.
4. Productivity and verification: JSON/CSV export, transactional JSON import, monthly calendar, holiday seeds, unit/database tests and 12 Playwright feature files.

## Resolved differences and implementation choices

- **Calendar size:** detailed PRP 10 asks for exactly 42 cells; `00` asks for five or six rows. `00` wins: the grid contains 35 or 42 cells, always complete weeks.
- **Templates:** preserve subtasks, unlike the simplified user guide. Store relative offsets instead of concrete dates and exclude tags. Recurring/reminder templates require a due offset of at least two minutes, keeping generated tasks valid under the one-minute minimum.
- **Backups:** nested subtasks and tags are included; creation timestamps are retained, while database IDs, user IDs, update timestamps and notification markers are excluded, following PRP 09's export type. Imports require the complete backup shape and preserve creation timestamps. CSV is export-only.
- **Authentication order:** implemented first, following `00`, rather than the index's auth-last presentation order. Every private API checks the session independently of page middleware.
- **Additional passkeys:** an existing username can only gain another passkey from an authenticated session for that account. An unauthenticated request with a duplicate username returns 409.
- **Reminder races:** the check endpoint selects and marks reminders in one SQLite transaction. The browser then displays the notifications. This prevents duplicate delivery across tabs; a browser/network failure after a claim can lose that notification. Exactly-once operating-system delivery cannot be guaranteed by browser polling. Notifications require the app to be open and permission granted; no background push service is specified.
- **Time representation:** date math and display run through `lib/timezone.ts`. Real instants remain real instants; bare local form values parse explicitly as UTC+8. Dates are stored with a Singapore offset, preventing host-timezone drift.
- **Calendar holidays:** the idempotent seed covers 2026–2027, including observed Mondays, using [MOM's holiday list](https://www.mom.gov.sg/employment-practices/public-holidays). Future years require an updated seed; no dates are invented.
- **Tag text:** arbitrary user-selected tag colors use whichever of dark/white text has sufficient contrast, extending the detailed PRP's white-only example for accessibility.
- **Framework convention:** `middleware.ts` is retained as explicitly requested. Next.js 16 supports it but emits a deprecation notice in favor of [`proxy.ts`](https://nextjs.org/docs/app/api-reference/file-conventions/proxy). It uses the Node runtime.
- **Models:** the Claude-specific Sonnet/Haiku routing table does not correspond to tools available in this session. The feature scope and build order are retained.

## Local use

```sh
npm install
# Copy .env.example to .env.local and set a random SESSION_SECRET (32+ characters).
npm run seed:holidays
npm run dev
```

Open `http://localhost:3000`, choose a username and create a passkey. Localhost supports WebAuthn; a deployed instance needs HTTPS, a persistent writable SQLite volume, and matching `APP_ORIGIN`/`RP_ID`. `SESSION_SECRET` must stay stable across restarts. The implementation session generated an ignored local environment file with a random secret; it is not committed.

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright uses virtual WebAuthn authenticators and Singapore timezone. It seeds and uses a separate ignored `.e2e-todos.db`; unit/database tests use in-memory SQLite. Browser tests bind port 3000, so stop an existing dev server before running them. Test accounts use unique usernames.

Deployment should place the app behind a trusted proxy that overwrites `X-Forwarded-For`, which supplies the authentication rate-limit key. Mutating endpoints enforce the configured request origin; private endpoints also enforce per-user rate limits. No production deployment is performed by this repository implementation task.

## Verification record

- Production build, generated-route type check, and ESLint completed successfully.
- All 24 unit/database/session tests pass, including timezone-offset creation sorting, recurrence clamping, ownership, cascade deletion, transactional import, reminder claims and JWT expiry/tampering.
- The complete Playwright run passed all 17 tests across the 12 feature files. The final sorting/dialog-accessibility adjustments are additionally checked with the priority and calendar browser tests.
- Desktop and 390px mobile screenshots were inspected. Light/dark layouts stay within the viewport.
- Real operating-system notification delivery and physical security keys were not manually exercised; browser tests use a notification stub and Chromium virtual WebAuthn authenticators.
- Native screenshots can be regenerated with `npm run preview:capture` while the local app is running. The script uses a new demo account and writes ignored files in `artifacts/previews/`.
