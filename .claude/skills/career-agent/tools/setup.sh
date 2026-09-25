#!/usr/bin/env bash
# Recreate the toolchain leakscan.py and packcheck.py need.
#
# The container ships LibreOffice core only - no Writer, so nothing converts -
# and the system python has a broken cryptography binding that makes pypdf
# unimportable. Both are fixed here. Safe to re-run.
#
# Prints the interpreter path to use for the tools.

set -euo pipefail
VENV=${VENV:-/tmp/claude-0/ca-venv}

if ! dpkg -l libreoffice-writer >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq libreoffice-writer >/dev/null
fi

# Poppins for TPCL work. Trebuchet MS is proprietary and its package is
# unreachable here, so personal-work renders stay Mac-only.
if ! fc-list : family | grep -qi poppins; then
  d=/usr/local/share/fonts/poppins && mkdir -p "$d"
  css=$(curl -fsS -A Mozilla/5.0 \
    "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,400;0,700;1,400")
  i=0
  for u in $(printf '%s' "$css" | grep -oE 'https://fonts\.gstatic\.com/[^)]+'); do
    i=$((i+1)); curl -fsS -o "$d/poppins-$i.ttf" "$u"
  done
  fc-cache -f >/dev/null
fi

[[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet python-docx pypdf

echo "$VENV/bin/python"
