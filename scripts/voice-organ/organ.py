#!/usr/bin/env python3
"""The voice organ — resident Kokoro TTS service for the garden.

Holds the Kokoro-82M model warm on the 5060 Ti and serves mp3 over local HTTP,
so `routes/voice.ts` can render speech on-card instead of calling OpenAI
(P0 probe 2026-08-12: RTF 0.19, residency costs VRAM only — P8/~7.4W floor held).

Endpoints (localhost only — the Express server is the auth boundary):
  GET  /health  → {"status":"ok","device":...,"pipelines":[...],"warm":true}
  GET  /voices  → {"voices":[...]} — voice ids discovered from the model snapshot
  POST /tts     → body {"text": str, "voice": str} → audio/mpeg bytes

Renders are serialised behind a lock (one GPU model, sequential is correct).
wav (24 kHz) is piped through ffmpeg → mp3 128k so the Express layer serves
byte-shapes identical to the OpenAI path (audio/mpeg, no client changes).

Runtime: ~/voice-organ/venv (kokoro + torch cu128 + soundfile), ffmpeg on PATH.
Unit: scripts/voice-organ/voice-organ.service (installed at land).
"""
import glob
import io
import json
import os
import re
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
from kokoro import KPipeline

PORT = int(os.environ.get("VOICE_ORGAN_PORT", "3851"))
BIND = "127.0.0.1"  # never expose beyond the box — no auth layer here
SAMPLE_RATE = 24000
MAX_TEXT_CHARS = 6000  # the Express layer chunks at 2500; this is a hard belt
VOICE_RE = re.compile(r"^[a-z]{2}_[a-z0-9]+$")  # e.g. bm_fable, af_heart
WARM_VOICE = os.environ.get("VOICE_ORGAN_WARM_VOICE", "bm_fable")

_lock = threading.Lock()
_pipelines: dict[str, KPipeline] = {}


def get_pipeline(voice: str) -> KPipeline:
    """One pipeline per language code (the voice id's first letter)."""
    lang = voice[0]
    if lang not in _pipelines:
        _pipelines[lang] = KPipeline(lang_code=lang)
    return _pipelines[lang]


def list_voices() -> list[str]:
    """Voice ids from the HF snapshot's voices/ dir — the menu for choosing."""
    pattern = os.path.expanduser(
        "~/.cache/huggingface/hub/models--hexgrad--Kokoro-82M/snapshots/*/voices/*.pt"
    )
    return sorted({os.path.splitext(os.path.basename(p))[0] for p in glob.glob(pattern)})


def render_mp3(text: str, voice: str) -> bytes:
    """text → Kokoro wav segments → concatenated → ffmpeg → mp3 bytes."""
    with _lock:
        pipe = get_pipeline(voice)
        segments = []
        for _, _, audio in pipe(text, voice=voice):
            arr = audio.numpy() if hasattr(audio, "numpy") else np.asarray(audio)
            segments.append(arr)
    if not segments:
        raise RuntimeError("Kokoro produced no audio segments")
    wav_buf = io.BytesIO()
    sf.write(wav_buf, np.concatenate(segments), SAMPLE_RATE, format="WAV")
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error",
         "-f", "wav", "-i", "pipe:0",
         "-codec:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "pipe:1"],
        input=wav_buf.getvalue(), capture_output=True, check=True,
    )
    return proc.stdout


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quiet the default per-request stderr noise
        pass

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._json(200, {
                "status": "ok",
                "pipelines": sorted(_pipelines.keys()),
                "warm": bool(_pipelines),
                "port": PORT,
            })
        elif self.path == "/voices":
            self._json(200, {"voices": list_voices()})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/tts":
            return self._json(404, {"error": "not found"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
            text = req.get("text")
            voice = req.get("voice")
            if not text or not isinstance(text, str):
                return self._json(400, {"error": "text is required"})
            if len(text) > MAX_TEXT_CHARS:
                return self._json(400, {"error": f"text exceeds {MAX_TEXT_CHARS} chars"})
            if not voice or not VOICE_RE.match(voice):
                return self._json(400, {"error": "voice must match ^[a-z]{2}_[a-z0-9]+$"})
            if voice not in list_voices():
                return self._json(400, {"error": f"unknown voice '{voice}' — GET /voices for the menu"})
            mp3 = render_mp3(text, voice)
            self.send_response(200)
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Length", str(len(mp3)))
            self.end_headers()
            self.wfile.write(mp3)
        except subprocess.CalledProcessError as err:
            self._json(500, {"error": "ffmpeg failed", "detail": err.stderr.decode(errors="replace")[:500]})
        except Exception as err:  # fail loud with the reason, never silent
            self._json(500, {"error": "render failed", "detail": str(err)[:500]})


def main() -> None:
    # Warm the default voice at boot so the first real render pays no load cost
    # (P0: model load ~4s; first-render kernel compile dominates otherwise).
    print(f"[organ] warming {WARM_VOICE}…", flush=True)
    render_mp3("The organ is warm.", WARM_VOICE)
    print(f"[organ] warm; listening on {BIND}:{PORT}", flush=True)
    ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
