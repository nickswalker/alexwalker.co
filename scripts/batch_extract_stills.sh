#!/bin/bash
# Batch: for each (key, youtube-or-vimeo URL) pair, download the trailer
# and run scripts/extract_movie_stills.py to dump per-shot stills into
# /tmp/movie_stills/<key>/. Output dir is opened in Finder at the end.
set -uo pipefail

ROOT="/Users/alexwalker/Coding Projects/Portfolio Website Redesign"
OUT=/tmp/movie_stills
mkdir -p "$OUT"
LOG="$OUT/batch.log"
exec > >(tee -a "$LOG") 2>&1

VENV=/tmp/scene_venv/bin
EXTRACT="$ROOT/scripts/extract_movie_stills.py"

# key | url pairs. Skipped:
#   hoa / tch / acinh — already have real stills
#   hc — no video URL (frames-only)
#   comm_samplereel — playlist URL, not a single clip
ITEMS=(
  "myth|https://www.youtube.com/watch?v=_XKFrOgiims"
  "mythbts|https://www.youtube.com/watch?v=_5H9xEL8Bk0"
  "amorsui|https://www.youtube.com/watch?v=j3LnsGa4kkM"
  "attad|https://www.youtube.com/watch?v=BSG8qTgcM-A"
  "alit|https://www.youtube.com/watch?v=21exc6yWNDA"
  "jr|https://www.youtube.com/watch?v=xxByzOj_yQY"
  "goh|https://www.youtube.com/watch?v=lTXui3zq3oU"
  "comm_everydaydose|https://www.youtube.com/watch?v=WyuawAo2lGk"
  "comm_ford|https://www.youtube.com/watch?v=tSCy4Xx6kZM"
  "comm_wls|https://www.youtube.com/watch?v=J22Ny4cShC0"
  "comm_stritt|https://www.youtube.com/watch?v=ejjn4pXuaw0"
  "comm_bostin|https://www.youtube.com/watch?v=ukfdG8Y8ats"
  "comm_viceguide|https://www.youtube.com/watch?v=JoHFyLAUnzY"
  "comm_applovin|https://www.youtube.com/watch?v=WpWfQuswgJQ"
  "comm_josey|https://www.youtube.com/watch?v=l73X6ejf4Cc"
  "comm_goody|https://www.youtube.com/watch?v=fG-ui_xiqG8"
  "comm_earthspeed|https://www.youtube.com/watch?v=2mbCPu54pn8"
  "comm_targetcool|https://www.youtube.com/watch?v=ZrGsJ7PphDA"
)

START=$(date +%s)
echo "[batch] starting at $(date)"
echo "[batch] $(echo "${ITEMS[@]}" | wc -w) items"

for entry in "${ITEMS[@]}"; do
  key="${entry%%|*}"
  url="${entry##*|}"
  dest="$OUT/$key"
  mkdir -p "$dest"
  video="$dest/source.mp4"

  echo
  echo "================================================================"
  echo "[$key] $url"
  echo "================================================================"

  if [ ! -f "$video" ]; then
    "$VENV/yt-dlp" \
      -f "bestvideo[ext=mp4][height<=2160]+bestaudio/best[ext=mp4]/best" \
      --merge-output-format mp4 \
      -o "$video" \
      "$url" || { echo "[$key] yt-dlp failed"; continue; }
  else
    echo "[$key] already downloaded: $video"
  fi

  # Already extracted? skip
  if compgen -G "$dest/shot_*.jpg" > /dev/null; then
    echo "[$key] already has stills; skipping extraction"
    continue
  fi

  "$VENV/python" "$EXTRACT" "$video" "$dest" --threshold 27 --candidates 5 \
    || { echo "[$key] extractor failed"; continue; }
done

END=$(date +%s)
ELAPSED=$(( END - START ))
echo
echo "[batch] done in ${ELAPSED}s. Output → $OUT"
open "$OUT"
