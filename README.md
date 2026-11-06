# Billaura – Smart Billing & Business

Modern mobile billing app for inventory, invoices, parties, reports and more.

## Branding
- **Name**: Billaura
- **Primary**: `#2563EB` · **CTA**: `#E11D48`
- Logo: `assets/logo.svg`

## Screens
| Area | Features |
|------|----------|
| **Home** | You'll Get / Give, quick actions, recent TXNs |
| **Dashboard** | Sale overview, profit, stock stats |
| **Items** | Products, stock, barcode, categories |
| **Menu** | Sale, Purchase, Expenses, Reports, Cash & Bank, Parties, Grow, Settings |
| **Business Profile** | Name, phones, email, address, tax ID, currency |
| **Settings** | Transaction, Invoice Print, Taxes, Item, Party, General |
| **Cash In-Hand** | Balance, adjust cash, day book |
| **Reports** | Sale, P&L, Party, Stock, Expense, Tax menus |
| **Multi-Currency** | Base currency + extra rates |
| **Reminders** | Overdue payment reminders (WhatsApp) |
| **Online Store** | Catalog share (Premium gate) |

## Print
Invoice Print toggles control PDF & thermal receipts:
- Company name, logo, address, email, phone, TIN
- Received / balance amounts
- Amount in words (Indian / International)

## Run
Open `index.html` or host on GitHub Pages / Vercel / Netlify.  
Add to Home Screen for PWA use.

## Data
Browser localStorage. Use **Backup / Restore** regularly. Optional Supabase sync.

## Billaura update (Billaura-style)
- New red "B" logo + icons, theme (css/theme.css)
- Fixed dead buttons / missing functions (modals, scanner, favourites, invoice open, custom items, POS)
- New Invoice Theme screen: 7 templates, 10 colours, text size, page size, orientation (js/templates.js)
- PDF / print / share-image now use the chosen template; Delivery Note
- Business Profile: completeness bar, 8 business-card designs + Share Card, draw signature


© 2026 Billaura. All rights reserved. See COPYRIGHT.txt.


## v6 changes
Category & payment-type sheets, Sale screen (Credit/Cash switch, Share+Save), 7 new print themes, payment & service reminders, download PDF/Image buttons, flat-amount tax, no more periodic blink, fixed layout of sheets, brand logo on lock/sign-in.

## v7
All browser popups (alert/confirm/prompt), dropdowns, date pickers, suggestion lists and checkboxes now use the app's own styled controls (js/ui.js).

## v9
Barcode label printing (offline Code 128), low-stock and daily-summary alerts on Home, send-all payment reminders with statements, multiple staff users with their own PINs, floating-label Sale fields, download PDF/Image in the transaction menu.

## Staff roles
Owner PIN opens everything. Each staff user gets a role — Manager, Accountant, Cashier, Salesperson, Storekeeper or Custom — that controls which screens, menu items and actions they can use (App Lock → Role). Settings, PINs and account stay owner-only.

## Item photos (one-time setup)
Photos are uploaded to a Supabase Storage bucket so they show on your public store page.
1. Supabase → SQL Editor → paste and run `supabase/storage.sql` (once).
2. In the app: Items → open an item → tap the photo box → pick a picture. Then Online Store → **Update Store Page**.
Without that setup (or while signed out) photos are kept on the phone and shown in the item list only; they upload automatically the next time you tap Update Store Page while signed in.

## Install note (splash screen)
After updating, remove the old Billaura icon from the home screen and add it again so Android refreshes the splash colours and icon.

## Short store link (one-time setup)
Your store can have an address like `yoursite/billaura/store/my-shop-name` instead of a long random link.
1. Supabase → SQL Editor → run `supabase/stores.sql` once.
2. In the app: sign in to the cloud → Online Store → **Update Store Page**. A name is picked from your business name; tap **Change name** to choose your own.
3. Keep `404.html` in the site root – GitHub Pages uses it to turn `/store/<name>` into the store page.
Without the setup (or while signed out) the long link keeps working.

## Desktop version
On screens 900px wide or more, Billaura switches to a desktop layout: a left sidebar (Home, Dashboard, Sale, Purchases, Items, Parties, Expenses, Reports, Cash & Bank, Online Store, All Menu, Settings), two-column lists, centred dialogs, and an invoice form with totals/payment in a side panel. Phones keep the bottom-nav layout. On Windows/Mac open the site in Chrome or Edge and choose **Install app** to get it in its own window.

## Windows app (.exe)
Run **Actions → Build Windows app → Run workflow** on GitHub, then download the installer from the run's *Artifacts*. See `desktop/README.md`.

## Apps from this repo
- **Windows (.exe, auto-updating):** see `desktop/README.md` (workflow *Build Windows app*).
- **Android (.apk):** see `android-app/README.md` (workflow *Build Android app (APK)*).
Both are built from the same web files, so each new tag (`git tag v1.0.2 && git push --tags`) builds and publishes them together.

## Website, landing page and updates
- `landing.html` is the public page (features, downloads, FAQ, contact); `terms.html` has terms, licence and privacy (written for how Billaura works; have a lawyer review). Edit contact details in `js/site-config.js` (set your real WhatsApp number).
- First-time visitors to the site are sent to the landing page once; "Continue in browser" opens the app (`./?app=1`).
- Download buttons use permanent links: `https://github.com/faisalchaudhary411/billaura/releases/latest/download/Billaura.apk` and `.../Billaura-Setup.exe`.
- Licence and announcements setup: `supabase/LICENSE-SETUP.md`.

## Counter Pack (v28)
`js/counter.js` adds: Quick Sale POS (hold/resume, discount, split pay, change calculator), Shift & cash drawer with Z-report, manager PIN approval, Return/Exchange, Daily closing report, Buy Today list, Purchase orders with goods-received (batch + expiry), Stock count with losses report, Expiry & batches (oldest sold first), and Backup & Restore (daily restore points, share file). Menu → "Counter Pack". No SQL needed; data lives in the shop settings that already sync.

## Branches / franchise (v29)
`js/branches.js`: Pro feature `branches`. Menu → Counter Pack → Branches & Head Office. Add branches, move stock with Transfers (send, then receive with a shortage check), per-branch bill numbers (code prefix), per-branch prices in Quick Sale, staff tied to a branch, head-office comparison dashboard, and an Audit log. All branches share one shop's data; product stock stays the company total and each branch's share is kept in settings. Admin plan table shows the new row.

## Landing page and legal pages (v30)
`landing.html`, `terms.html` and `css/landing.css` were redesigned: a warm Pakistan-flavoured theme (Fraunces, Plus Jakarta Sans, Noto Nastaliq Urdu from Google Fonts), original SVG illustrations in `assets/art/`, and real app screenshots of Simple Mode in `assets/shots/`.
`terms.html` is written around how Billaura works (offline-first data, licence and device limit, manual payments, 7-day refund rule, Supabase/GitHub/Google Fonts disclosure, FBR/PRA not integrated). Edit the operator name, refund window, liability cap (PKR 5,000) and grace-period wording there if your business rules differ.
Set your real WhatsApp number in `js/site-config.js`.
