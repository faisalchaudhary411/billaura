# Billaura – Smart Billing & Business

Vyapar-inspired mobile billing app for inventory, invoices, parties, reports and more.

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

## Billaura update (Vyapar-style)
- New red "B" logo + icons, Vyapar-like theme (css/vyapar.css)
- Fixed dead buttons / missing functions (modals, scanner, favourites, invoice open, custom items, POS)
- New Invoice Theme screen: 7 templates, 10 colours, text size, page size, orientation (js/templates.js)
- PDF / print / share-image now use the chosen template; Delivery Note
- Business Profile: completeness bar, 8 business-card designs + Share Card, draw signature
