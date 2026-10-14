# Local transcription server

The extension's **Local server (WhisperLiveKit)** provider streams audio to
[WhisperLiveKit](https://github.com/QuentinFuxa/WhisperLiveKit) running on this
machine, through its Deepgram-compatible endpoint (`ws://localhost:8000/v1/listen`).
Free and private; slower than Deepgram.

```sh
./server/setup.sh          # once: Python 3.12 venv in server/.venv (~5 GB with torch/CUDA)
./server/run.sh            # Whisper small, any language
./server/run.sh --model base   # faster, weaker (fine for English, poor for French)
```

Then pick **Local server** in the extension options. Extra arguments go to
`whisperlivekit-server` (`--help` lists them). The first start downloads the model.

`serve.py` wraps the server with two fixes:
- WhisperLiveKit's Deepgram adapter split Whisper sub-word tokens into separate
  words ("l'opin ion", "pre uve"); tokens are grouped back into words.
- faster-whisper runs in `int8_float16` instead of `float16` (2.5× faster on a
  GTX 1650, same text). `WLK_COMPUTE_TYPE=auto` restores the default.

## Measured on a GTX 1650 (4 GB) + Ryzen 5 3550H

Median delay from a word being spoken to it appearing, with Firefox playing the
video on the same machine (`e2e/harness.py`, 45 s clips):

| Model | English | French | VRAM |
| --- | --- | --- | --- |
| base | 0.9 s | 0.9–2.9 s, many errors | 0.7 GB |
| small | 2.7–3.8 s | 2.5–7 s | 1.5 GB |
| Deepgram Nova-3 (cloud) | 0.64 s | — | — |

The server is CPU-bound here (~2 cores busy, GPU at ~30 %), so the delay drifts
up when the machine is busy. Batch transcription is far faster (small: 30 s of
audio in 1.9 s), which is what the planned look-ahead mode will use.

Known issue: about 1 in 4 sessions starts in a state where WhisperLiveKit sends
text but never commits timed words. The extension detects this after 5 s and
reconnects.
