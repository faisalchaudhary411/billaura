#!/usr/bin/env bash
# Gives the generated Android project Billaura's icon and ONE red launch screen. Cosmetic only; never fails the build.
# Capacitor's template draws the launcher icon from an adaptive-icon XML that points at drawable/ic_launcher_background
# and drawable(-v24)/ic_launcher_foreground, so replacing only the PNGs leaves the default blue "X" icon. We replace all of it.
set -u
RES=android/app/src/main/res
SRC=../assets/icon-maskable-512.png

# 1) launcher icons, adaptive foregrounds and splash logo are pre-generated PNGs in brand/res (no ImageMagick needed)
cp -r brand/res/. "$RES"/ || echo "brand.sh: could not copy brand/res"
for d in "$RES"/mipmap-*; do rm -f "$d"/ic_launcher*.webp; done

# 2) remove the template's default vector background/foreground and adaptive XMLs, then write ours
rm -f "$RES"/drawable*/ic_launcher_foreground.xml "$RES"/drawable*/ic_launcher_background.xml
mkdir -p "$RES/values" "$RES/mipmap-anydpi-v26"
cat > "$RES/values/ic_launcher_background.xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#E8173C</color></resources>
X
for f in ic_launcher ic_launcher_round; do
cat > "$RES/mipmap-anydpi-v26/$f.xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@color/ic_launcher_background"/>
  <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
X
done

# 3) one launch screen: brand red + logo (Android 11 and older); Android 12+ shows the launcher icon on red
find "$RES" -name 'splash.png' -delete
mkdir -p "$RES/drawable"
if [ -f "$RES/drawable/splash_logo.png" ]; then
cat > "$RES/drawable/splash.xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item><shape android:shape="rectangle"><solid android:color="#E8173C"/></shape></item>
  <item android:width="128dp" android:height="128dp" android:gravity="center"><bitmap android:src="@drawable/splash_logo" android:gravity="fill"/></item>
</layer-list>
X
else
cat > "$RES/drawable/splash.xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#E8173C"/></shape>
X
fi
ST="$RES/values/styles.xml"
if [ -f "$ST" ]; then
  sed -i 's|<item name="android:background">@drawable/splash</item>|<item name="android:background">@drawable/splash</item><item name="android:windowSplashScreenBackground">#E8173C</item>|' "$ST" || true
  if grep -q 'Theme.SplashScreen' "$ST"; then
    sed -i 's|<item name="android:background">@drawable/splash</item>|<item name="android:background">@drawable/splash</item><item name="windowSplashScreenBackground">#E8173C</item>|' "$ST" || true
  fi
fi
echo "brand.sh: done"
ls "$RES"/mipmap-anydpi-v26 "$RES"/drawable* 2>/dev/null
exit 0
