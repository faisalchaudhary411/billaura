# Billaura desktop (Windows)

## Test build
GitHub -> **Actions** -> **Build Windows app** -> **Run workflow**. After 3-5 minutes download **Billaura-Windows** from *Artifacts* (installer + portable `.exe`).

## Real release (this is what auto-updates PCs)
```
git tag v1.0.1
git push --tags
```
The workflow builds the app with that version number and publishes it to **Releases** (installer, portable and `latest.yml`). Copies installed with the setup `.exe` check for a newer release at start-up and every 6 hours, download it in the background and ask to restart. Use a higher number each time (v1.0.2, v1.1.0 ...).

The portable `.exe` does not self-update: download the new one when you want it.

Data on the PC is stored separately from the phone. Sign in with the same cloud account on both to sync.
