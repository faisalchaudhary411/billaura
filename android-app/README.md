# Billaura Android app (.apk)

Built by `.github/workflows/android.yml` (Capacitor wraps the same web app in a native Android shell).

## Quick test build
GitHub -> Actions -> **Build Android app (APK)** -> Run workflow -> download **Billaura-Android** from Artifacts -> unzip -> install `Billaura-debug.apk` (allow "install unknown apps").
Without a signing key each build is signed with a throw-away key, so a newer test APK cannot be installed over an older one: uninstall first.

## Proper builds that update over the old one (one-time key setup, in Termux)
```
pkg install openjdk-17
keytool -genkeypair -v -keystore billaura.jks -alias billaura -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 billaura.jks
```
Keep `billaura.jks` and its passwords safe and private (never commit it). Then in the repo: Settings -> Secrets and variables -> Actions -> New repository secret:
- `ANDROID_KEYSTORE_BASE64` = the long base64 text
- `ANDROID_KEYSTORE_PASSWORD` = keystore password
- `ANDROID_KEY_ALIAS` = billaura
- `ANDROID_KEY_PASSWORD` = key password

From then on every build is a signed `Billaura.apk`. Push a tag (`git tag v1.0.1 && git push --tags`) to publish it on Releases.
