# Billaura Admin – Your SaaS side

This is **your** console as the platform owner. The seller app (Billaura) is what shops use daily.

## Login
- Open `index.html` (or host on a private URL)
- Default password: **billaura2026**
- Change it immediately under **Settings**

## What you can do
- **Dashboard** – total shops, active, trials, MRR, plus a **Needs attention** list (pending payments, plans ending in 7 days, trials ending in 3 days, lapsed shops) with one-tap WhatsApp reminders
- **Shops** – add / edit / pause / expire each seller business; search, filter by status, WhatsApp the owner, export CSV
- **Plans** – prices plus a table of what each plan unlocks inside the Billaura app (items/invoice limits, PIN lock & staff roles, bulk tools…)
- **Subscriptions** – see who is paid, trial, expired
- **Settings** – support contacts, currency, password, export/import

## Two apps

| App | Who uses it | Purpose |
|-----|-------------|---------|
| **Billaura** (seller) | Shop owners | Inventory, invoices, customers, QR pay |
| **Billaura Admin** (you) | You only | Manage shops, plans, revenue |

## Current mode: Local
Admin data is stored in **this browser** only. Good for:
- Learning the workflow
- Tracking shops you onboard manually
- Setting plan prices

## Next step: Real multi-shop cloud
When you are ready to sell online accounts:
1. Free **Supabase** project (auth + Postgres)
2. Sellers register / login in Billaura app
3. Admin reads the same database
4. Optional: JazzCash / Stripe for collecting subscription fees

Ask for the Supabase wiring guide when you want to go live.

## Hosting tip
Host Admin on a **private** link or password-protect the folder.
Do not put the default password on a public page without changing it.

## Installing on your phone
Open the admin URL in Chrome → menu → *Add to Home screen*. It uses the same red Billaura look and icon as the seller app.

## Keep in sync with the seller app
The limits shown on the Plans page mirror `js/freemium.js` in Billaura and the `enforce_plan_limit` trigger in `supabase/schema.sql`. If you change one, change all three.

## v5: Announcements and Licence pages
Needs `supabase/license.sql`, `announcements.sql` and the `license` Edge Function. See `supabase/LICENSE-SETUP.md`.
