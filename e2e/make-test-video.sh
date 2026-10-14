#!/bin/sh
# 40 s test video: color bars, with a 440 Hz tone (-30 dB) that alternates
# 4 s on / 4 s off, so Test-signal readings can be checked against it.
set -e
cd "$(dirname "$0")/site"
ffmpeg -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=25:duration=40" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=40" \
  -filter_complex "[1:a]volume='if(lt(mod(t,8),4),0.5,0)':eval=frame,aformat=channel_layouts=stereo[a]" \
  -map 0:v -map "[a]" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 500k -c:a libopus test.webm
echo "wrote e2e/site/test.webm"
