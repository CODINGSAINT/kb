#!/usr/bin/env bash
# Run from YOUR OWN terminal (not from inside an assistant session — see spec §6).
# Uses the Claude Code CLI in non-interactive mode to fill in content files.
#   scripts/generate-day.sh            -> scaffold + write the next day
#   scripts/generate-day.sh 5          -> scaffold + write day 5
#   scripts/generate-day.sh pending    -> evaluate saved answers + answer open doubts
set -euo pipefail
cd "$(dirname "$0")/.."
command -v claude >/dev/null || { echo "Claude Code CLI ('claude') not found on PATH"; exit 1; }

if [[ "${1:-next}" == "pending" ]]; then
  PENDING="$(node scripts/pending.js)"
  [[ "$PENDING" == "Nothing pending." ]] && { echo "$PENDING"; exit 0; }
  claude -p --allowedTools "Read,Edit" <<PROMPT
You maintain the KB study site in this folder. Read AUTHORING.md first and follow it exactly.
Handle every item below, editing only the JSON files named:
$PENDING
PROMPT
  exit 0
fi

OUT="$(node scripts/new-day.js "${1:-next}")"; echo "$OUT"
FILE="$(sed -E 's/^scaffolded ([^:]+):.*/\1/' <<<"$OUT")"
claude -p --allowedTools "Read,Edit,Write" <<PROMPT
You maintain the KB study site in this folder. Read AUTHORING.md first and follow it exactly.
$FILE has been scaffolded with titles and concepts. For each of its 3 topics, write the full
"markdown" write-up and the "diagram" spec per AUTHORING.md. Keep every other field unchanged.
PROMPT
