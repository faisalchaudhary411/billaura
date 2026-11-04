#!/usr/bin/env bash
# Gives the generated Android project Billaura's icon and red launch screen. Cosmetic only.
set -u
RES=android/app/src/main/res
SRC=../assets/icon-maskable-512.png
CONV=convert; command -v magick >/dev/null 2>&1 && CONV=magick
for d in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do
  IFS=: read -r n l f <<< "$d"
  mkdir -p "$RES/mipmap-$n"
  $CONV "$SRC" -resize "${l}x${l}" "$RES/mipmap-$n/ic_launcher.png"
  cp "$RES/mipmap-$n/ic_launcher.png" "$RES/mipmap-$n/ic_launcher_round.png"
  $CONV "$SRC" -resize "${f}x${f}" "$RES/mipmap-$n/ic_launcher_foreground.png"
done
mkdir -p "$RES/values"
cat > "$RES/values/ic_launcher_background.xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#E8173C</color></resources>
X
# plain brand-red launch screen instead of the default Capacitor image
find "$RES" -name 'splash.png' -delete
mkdir -p "$RES/drawable"
cat > "$RES/drawable/splash.xml" <<'X'
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#E8173C"/></shape>
X
sed -i 's|<item name="android:background">@drawable/splash</item>|<item name="android:background">@drawable/splash</item><item name="android:windowSplashScreenBackground">#E8173C</item>|' "$RES/values/styles.xml" || true
exit 0
