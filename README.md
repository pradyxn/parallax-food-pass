# Parallax Food Pass

A mobile-first attendee and meal operations app for Parallax Freshers 2026. It provides unique QR passes, staff-only entry check-in, food-preference verification, one-meal-per-attendee protection, CSV import/export, and live counters shared across devices.

## Important architecture notes

- **One shared database:** all entry-gate and food-counter devices use the same Supabase database. Browser local storage is not used for the event records.
- **One QR per attendee:** QR values are unguessable UUID pass tokens. They do not encode names, roll numbers, or food preferences.
- **Separate scans:** entry scan sets `checked_in_at`; the food scan reserves a meal, then a staff confirmation after handover sets `meal_collected_at`.
- **Duplicate protection:** conditional database updates prevent duplicate entry scans, and a five-minute meal reservation prevents multiple food counters from handling the same pass at once.
- **Access control:** admin APIs require a signed, HTTP-only staff session. The Supabase service-role key stays on the server and is never exposed to the browser. Public registration and pass lookup use server routes.

## 1. Create the shared database

1. Create a project in [Supabase](https://supabase.com/) if you do not already have one.
2. For a new database, open **SQL Editor** and run `supabase/schema.sql`.
3. For an existing deployment, verify the reservation columns and indexes from `supabase/migrations/20261119_meal_reservations.sql` are present. This migration is additive and does not alter or delete attendee records; its unique roll-number index will fail safely if existing case-insensitive duplicates need manual review.
4. Run `supabase/migrations/20261119_2250_service_role_attendees_grants.sql` in the Supabase SQL Editor. It grants only `SELECT`, `INSERT`, and `UPDATE` on `public.attendees` to the server-only `service_role`; it does not grant access to `anon` or `authenticated`, change RLS, or modify attendee data.
5. Run `supabase/migrations/20261120_google_registration_sync.sql`. This additive migration adds the email outbox, default-off delivery settings, sync logs/state, and the concurrency-safe registration RPC. It does not delete or rewrite attendees, pass tokens, or check-in data.
6. In **Project Settings → API**, copy the Project URL and `service_role` key. Keep the service-role key private; it must only be configured as a server environment variable.

## 2. Configure environment variables

Create `.env.local` from `.env.example` if it does not exist. If `.env.local` already exists, preserve it and add or update the required values manually:

```env
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
ADMIN_PIN=choose-a-private-staff-pin
SESSION_SECRET=use-a-random-secret-with-at-least-32-characters
GOOGLE_SYNC_SECRET=use-a-separate-random-secret-with-at-least-32-characters
RESEND_API_KEY=
RESEND_FROM_EMAIL=
APP_BASE_URL=https://YOUR_DEPLOYED_HOST
```

Generate a session secret with one of these commands:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`GOOGLE_SYNC_SECRET` is required for the Google Sheets integration. Keep it server-side and store the matching value in Apps Script project properties, never in the spreadsheet or browser code. Resend variables and `APP_BASE_URL` are optional; automatic pass email remains disabled until configured and explicitly enabled in the admin UI.

Do not commit `.env.local` or share the service-role key or sync secret in chat, source control, or attendee-facing pages.

## 3. Run locally

Requires Node.js 20.9 or later (Node 22 recommended).

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Sign in with `ADMIN_PIN`.

## 4. Deploy

Deploy this folder as a Next.js project on Vercel (or another Node.js host that supports Next.js route handlers). Add the four core variables and `GOOGLE_SYNC_SECRET` in the host's project settings for the **Production** environment, then deploy. Add the optional Resend variables only when email delivery has been tested. Do not set `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_SYNC_SECRET` with a `NEXT_PUBLIC_` prefix.

After deployment:

- Staff sign in at `/`.
- Attendees register at `/register`.
- Generated attendee passes open at `/pass/{token}`.
- Use the same deployed URL on every scanning phone. Camera access requires HTTPS (the Vercel URL provides HTTPS).

## 5. Import the attendee list

In **Attendees → CSV template**, download the starter CSV. The admin report export also includes each attendee’s `pass_url` for sending or printing pass links. Required fields are:

| Column | Required | Notes |
|---|---|---|
| `name` | Yes | Full attendee name |
| `preference` | Yes | `VEG` or `NON_VEG` |
| `roll_number` | Yes | Duplicate roll numbers are reported and not imported |
| `branch` | No | Department / branch |

The importer normalizes header case, whitespace, underscores, hyphens, and punctuation. It recognizes Google Forms headers such as `Name`, `Hall ticket No:`, ` Section`, and `Food Preference `, as well as aliases such as `Full Name`, `Student Name`, `Hall Ticket Number`, `Department`, and `What is your food preference?`. Preference values such as `Vegetarian` and `Non veg` are normalized to `VEG` and `NON_VEG`. The admin import API accepts `dryRun: true` alongside `rows` to validate and report the rows without reading or writing attendee records. The importer reports missing fields, invalid food preferences, duplicates, invalid rows, and rows left unprocessed after a database failure. Importing a row generates its QR token automatically. Use **Export report** to download the current registry, attendance, and meal collection statuses.

## 6. Synchronize Google Forms responses

The server endpoint is `POST /api/sync/google`. It requires `Authorization: Bearer <GOOGLE_SYNC_SECRET>`. The secret is checked only by the server; do not put it in a web page or spreadsheet cell. The API supports a read-only dry-run and 100-row write batches. Registration updates match on trimmed, case-insensitive roll number, keep the existing pass token and check-in timestamps, and do not replace stored optional email or branch values with blanks. Database uniqueness and batch logging protect concurrent/retried requests.

### Configure the linked response spreadsheet

1. Apply `supabase/migrations/20261120_google_registration_sync.sql`, deploy the server, and set `GOOGLE_SYNC_SECRET` to a unique random value of at least 32 characters in the hosting provider's server environment.
2. Open the **linked Google Forms response spreadsheet** and choose **Extensions → Apps Script**.
3. Paste the complete contents of [`scripts/google-sheets-sync.gs`](./scripts/google-sheets-sync.gs) into the editor and save the project.
4. Run `configureGoogleSync()` once. Enter the deployed HTTPS endpoint ending in `/api/sync/google`, then enter the same secret used for the server environment. Apps Script stores both values in script properties; they are not saved to cells or browser code.
5. Run `runInitialSyncWithReview()`. Authorize the requested spreadsheet and external-request permissions. The script rereads the full response sheet, calls the API in dry-run mode, and displays the report before any writes. Confirm only after the report shows zero rejected rows, zero duplicate response roll numbers, and zero existing duplicate roll numbers. Compare matched, insert, and update counts against the expected 202 responses. Canceling or any invalid/duplicate row prevents writes. Initial sync explicitly suppresses all email sending, even if email settings were enabled.
6. After the reviewed initial sync completes, run `installFiveMinuteTrigger()` once and authorize trigger creation. It removes any prior trigger for this handler and installs exactly one time-driven trigger every five minutes.

The script maps the Google Forms headers `Name`, `Email Address`, `Hall ticket No:`, `Year`, `Section` (including a leading space), and `Food Preference` (including trailing spaces). It also accepts the cleaned `name`, `roll_number`, `branch`, and `preference` format; email and branch columns are optional. `Section` supplies `branch`; `Year` is not substituted for it. Each run rereads all non-empty response rows rather than only appending new rows, so edits to old responses are detected without relying on a fragile timestamp checkpoint. The stored last-success timestamp and sync ID are informational checkpoints; full rescans plus idempotent upserts prevent missed changes. Writes are split into batches of 100, with dry-run validation before every scheduled write. View execution logs in Apps Script for dry-run and batch counts or errors.

### Optional Resend pass emails

Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and (recommended) `APP_BASE_URL` as server environment variables. Automatic delivery is off by default. In the staff dashboard's **Attendees → Pass emails** panel, explicitly enable new-registration emails after validating the sender and delivery. Existing email changes do not send a new pass unless the separate email-change option is enabled. Delivery attempts and failures are tracked in the outbox; staff can retry pending or failed jobs from the same panel. Do not send bulk emails during testing.

The Overview refreshes every 30 seconds and displays the 380-person target, remaining registrations, preference totals, latest successful sync, new registrations from that sync, sync errors, and email delivery counts.

## Event-day workflow

1. **Before event day:** import the confirmed student list. Share the public `/register` URL for last-minute registrations. Ask students to save their QR pass to their phone or print it.
2. **At the entrance:** open the staff dashboard on the gate phone, choose **Entry check-in**, allow camera access, and scan each attendee once.
3. **At the food counter:** open the same URL on the food-desk phone, choose **Food counter**, scan the same pass, check the large VEG / NON-VEG label, hand over the correct meal, and tap **Confirm meal handed over**. The counter reserves that pass for five minutes and records collection only after confirmation; cancel the reservation if no meal was handed over.
4. **Monitoring:** the Overview counters show registered, arrived, expected and collected VEG / NON-VEG quantities, remaining meals, and meals pending. Counts refresh after operations and every 30 seconds; use **Refresh data** for an immediate update.
5. **Close-out:** export the CSV report for the event record.

## Operational safeguards and limitations

- The initial implementation supports two meal categories only: `VEG` and `NON_VEG`.
- Public registration is open to anyone holding the registration URL. A roll number already in the system cannot register again; staff should retrieve that person's existing pass from the registry.
- Staff PIN sessions last 12 hours. Use a unique PIN and rotate it after the event if the deployment will remain online.
- Failed PIN attempts are rate-limited per server process. Use a persistent edge/platform rate limit as well when deploying to multiple server instances.
- Automatic email delivery is optional and disabled by default. Attendees can still open and save their pass from the confirmation page.
- Staff devices need an internet connection to use the shared database. If venue connectivity is unreliable, test mobile hotspots and keep the exported CSV as a fallback record; do not run two separate local copies and expect them to synchronize.
- This is event operations software, not an identity-verification system. Staff should compare names / college IDs when needed.
