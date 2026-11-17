#!/usr/bin/env bash
# Regenerates the small audio samples used by the tag-writing tests (unit and instrumented).
# Needs ffmpeg with libmp3lame, libvorbis, libopus. Output: app/src/sharedTest/audio/tags/.
set -euo pipefail
cd "$(dirname "$0")/.."
out=app/src/sharedTest/audio/tags
mkdir -p "$out"
tone=(-f lavfi -i "sine=frequency=440:duration=1:sample_rate=22050" -ac 1)
meta=(-metadata title="Old title" -metadata artist="Old artist" -metadata album="Old album" -metadata genre="Rock" -metadata track=3)
q=(-hide_banner -loglevel error -y)

ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a libmp3lame -b:a 32k -id3v2_version 3 "$out/v23.mp3"
ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a libmp3lame -b:a 32k -id3v2_version 4 "$out/v24.mp3"
ffmpeg "${q[@]}" "${tone[@]}" -map_metadata -1 -c:a libmp3lame -b:a 32k -id3v2_version 0 -write_xing 0 "$out/bare.mp3"
ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a flac "$out/tagged.flac"
ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a libvorbis -q:a 0 "$out/tagged.ogg"
ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a libopus -b:a 24k "$out/tagged.opus"
# moov before mdat (chunk offsets must move) and after it (they must not).
ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a aac -b:a 32k -movflags +faststart "$out/faststart.m4a"
ffmpeg "${q[@]}" "${tone[@]}" "${meta[@]}" -c:a aac -b:a 32k "$out/moov_last.m4a"
# Vorbis comments spanning two Ogg pages: rewriting drops to one page, so audio pages are renumbered.
big=$(python -c "print('A' * 70000)")
printf ';FFMETADATA1\ntitle=Big\nartist=%s\n' "$big" > build/big_meta.txt
ffmpeg "${q[@]}" "${tone[@]}" -i build/big_meta.txt -map 0 -map_metadata 1 -c:a libvorbis -q:a 0 "$out/bigcomment.ogg"
rm -f build/big_meta.txt
ls -l "$out"
