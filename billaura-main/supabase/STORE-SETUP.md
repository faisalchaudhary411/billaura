# Online store orders: one-time setup

1. Supabase → SQL Editor → run `supabase/stores.sql` and `supabase/license.sql` if you have not already.
2. Run `supabase/store-orders.sql`. It adds the `store_orders` and `store_stats` tables and two functions, `place_store_order` and `store_hit`.
3. In the app: Online Store → Update Store Page once, so the published catalogue carries item ids and your store settings. Old published stores do not have them, so ordering stays on WhatsApp until you do this.

How it works
- Customers open `/billaura/store/<name>`, fill the cart and tap Place order. The database function checks every price against the published catalogue, so a customer cannot change a price from the browser.
- Orders appear under Online Store → Manage Orders (and as a Home alert). Accept, mark delivered or cancel, then "Create bill" to make a normal sale that takes stock out.
- Customers can place at most 5 orders per hour from the same phone number.
- Orders and store views need the Pro plan (same rule as the store page).
- Stock is not reserved when an order is placed. It is deducted when you create the bill.
