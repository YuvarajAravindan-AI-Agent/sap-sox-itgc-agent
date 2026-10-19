"""Run on contabo-tally: one TTS call per scene (gateway 429s under parallel load). Plain spoken text only - no style prefix."""
import base64, json, os, sys, time, wave, requests
sys.path.insert(0, "/opt/ai-digest")
from trends import ENV
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import content
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, "audio"); os.makedirs(OUT, exist_ok=True)
MODEL = ENV.get("TTS_MODEL", "gemini-3.8-flash-tts")

def tts(text, voice):
    body = {"contents": [{"parts": [{"text": text}]}], "generationConfig": {"responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    err = ""
    for attempt in range(15):
        r = requests.post(f"{ENV['GEMINI_BASE']}/{MODEL}:generateContent", json=body, timeout=180, headers={"x-goog-api-key": ENV["GEMINI_API_KEY"]})
        if r.status_code == 200:
            try:
                b = base64.b64decode(r.json()["candidates"][0]["content"]["parts"][0]["inlineData"]["data"]); assert b[:4] == b"RIFF"; return b
            except Exception as e: err = f"bad payload {e}"
        else: err = f"HTTP {r.status_code}"
        print("  retry", attempt, err, flush=True); time.sleep(min(90, 10 * (attempt + 1)))
    raise RuntimeError(err)

voice = sys.argv[1] if len(sys.argv) > 1 else content.VOICE
info = {}
for sc in content.SCENES:
    p = os.path.join(OUT, sc["id"] + ".wav")
    if not os.path.exists(p):
        text = " ".join(s[1] for s in sc["sentences"]); print("tts", sc["id"], len(text), "chars", flush=True)
        open(p, "wb").write(tts(text, voice))
    with wave.open(p) as w: info[sc["id"]] = round(w.getnframes() / w.getframerate(), 2)
    print(sc["id"], info[sc["id"]], "s", flush=True)
json.dump(info, open(os.path.join(HERE, "durations.json"), "w"), indent=1)
print("DONE", sum(info.values()), "s total")
