# Billaura licence & announcements: one-time setup

Until step 5 is done the app runs in "legacy mode" (old behaviour), so nothing breaks if you do this slowly.

1. **SQL.** Supabase → SQL Editor → run `license.sql`, then `announcements.sql` (safe to re-run).
2. **Edge Function.** Supabase → Edge Functions → *Create function* named `license` → paste `functions/license/index.ts` → Deploy. (Keep "Verify JWT" ON.)
3. **Keys.** Open the Admin app → **Licence** → *Generate key pair* (do this once).
4. **Private key.** Supabase → Edge Functions → Secrets → add `LICENSE_PRIVATE_JWK` = the PRIVATE key. Never put it in GitHub.
5. **Public key.** In the app repo edit `js/license-config.js`:
   `window.BILLAURA_LICENSE_PUBKEY = {"kty":"EC","crv":"P-256","x":"…","y":"…"};` then commit and push. Only do this AFTER steps 2 and 4, otherwise paid users cannot verify.
6. In Admin → Licence set devices per shop (default 3) and offline grace days (default 10).

Announcements: Admin → Announcements → Publish. For a new version use type "update".

## Releasing new Windows / Android builds
`git tag v1.0.2 && git push --tags` builds both and publishes them to GitHub Releases under fixed names (Billaura-Setup.exe, Billaura-Portable.exe, Billaura.apk). The landing page links always get the newest. Installed Windows apps update themselves; Android users see an update notice with a download button. For a signed APK add the four ANDROID_KEYSTORE_* secrets (see android-app/README.md).

## Honest limits
Anything running on the user's device can be tampered with by a determined person. This design makes it hard and keeps the important rules on the server: signed licence tokens, device cap, plan limits enforced by database triggers, online-store gating, and a log of suspicious activity.
