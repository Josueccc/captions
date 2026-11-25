"""Start WhisperLiveKit with two fixes for the Auris extension.

1. Its Deepgram-compatible endpoint turns every Whisper sub-word token into its
   own word ("pre uve", "l'opin ion"). Tokens that don't start with a space
   continue the previous word, so we group them before they're split.
2. WhisperLiveKit loads faster-whisper with compute_type="auto", which picks
float16 on most GPUs. int8_float16 is ~2.5x faster on a GTX 1650 with the same
output, which decides whether the small model keeps up in real time.
Set WLK_COMPUTE_TYPE=auto to get the stock behavior.
"""
import os
import sys

import faster_whisper

compute_type = os.environ.get('WLK_COMPUTE_TYPE', 'int8_float16')
_init = faster_whisper.WhisperModel.__init__


def _patched_init(self, *args, **kwargs):
    if kwargs.get('compute_type', 'auto') == 'auto':
        kwargs['compute_type'] = compute_type
    _init(self, *args, **kwargs)


faster_whisper.WhisperModel.__init__ = _patched_init

from whisperlivekit import deepgram_compat  # noqa: E402

_line_to_words = deepgram_compat._line_to_words


def _grouped_line_to_words(line):
    tokens = None if isinstance(line, dict) or line.is_silence() else getattr(line, 'tokens', None)
    if not tokens:
        return _line_to_words(line)
    speaker = deepgram_compat._speaker_index(getattr(line, 'speaker', 1))
    groups = []
    for token in tokens:
        text = token.text or ''
        start = float(token.start or 0.0)
        end = float(token.end or token.start or 0.0)
        if groups and text and not text[0].isspace():
            groups[-1][0] += text
            groups[-1][2] = end
        else:
            groups.append([text, start, end])
    words = []
    for text, start, end in groups:
        words.extend(deepgram_compat._span_to_words(text, start, end, speaker))
    return words


deepgram_compat._line_to_words = _grouped_line_to_words

from whisperlivekit.basic_server import main  # noqa: E402

sys.exit(main())
