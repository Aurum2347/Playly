#!/usr/bin/env bash
# Tiny UI driver for manual emulator checks: tap by visible text / content-desc, take screenshots.
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb}"
# Git Bash would otherwise rewrite /sdcard/... into a Windows path.
export MSYS_NO_PATHCONV=1

dump() { "$ADB" shell rm -f /sdcard/ui.xml; "$ADB" shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; "$ADB" exec-out cat /sdcard/ui.xml; }

# tap "<text or content-desc>": taps the centre of the first node whose text/desc matches exactly.
tap() {
  local bounds
  bounds=$(dump | PYTHONIOENCODING=utf-8 python -c "
import sys, re, xml.etree.ElementTree as E
want = sys.argv[1]
for n in E.fromstring(sys.stdin.buffer.read()).iter('node'):
    if want in (n.get('text'), n.get('content-desc'), n.get('resource-id')):
        print(n.get('bounds')); break
" "$1")
  if [ -z "$bounds" ]; then echo "NOT FOUND: $1"; return 1; fi
  read -r x1 y1 x2 y2 <<<"$(echo "$bounds" | tr -c '0-9' ' ')"
  "$ADB" shell input tap $(( (x1 + x2) / 2 )) $(( (y1 + y2) / 2 ))
  sleep "${WAIT:-1.5}"
}

texts() { dump | PYTHONIOENCODING=utf-8 python -c "
import sys, xml.etree.ElementTree as E
for n in E.fromstring(sys.stdin.buffer.read()).iter('node'):
    t = n.get('text') or n.get('content-desc')
    if t: print(' -', t)
"; }

# checks: prints every checkable node (switches, checkboxes) with its checked state.
checks() { dump | PYTHONIOENCODING=utf-8 python -c "
import sys, xml.etree.ElementTree as E
for n in E.fromstring(sys.stdin.buffer.read()).iter('node'):
    if n.get('checkable') == 'true':
        print(' * checked=' + n.get('checked'), n.get('text') or n.get('content-desc') or n.get('class'))
"; }

# restart: force-stops the app and launches it again.
restart() {
  "$ADB" shell am force-stop com.playly.player.dev
  "$ADB" shell am start -n com.playly.player.dev/com.playly.player.MainActivity >/dev/null
  sleep "${WAIT:-3}"
}

shot() { "$ADB" exec-out screencap -p > "/tmp/shots/$1.png"; }

"$@"
