#!/usr/bin/env python3
"""Renders sox-demo.mp4 (1920x1080, H.264 + AAC) in the audit-workpaper-tickmark-binder look from demo/ only:
storyboard content.py, images in screens/, narration in audio/*.wav (+ durations.json).
Usage: python3 demo/render_video.py [outdir]     (needs ffmpeg, Pillow, numpy)
Caption timing inside a scene is estimated from character counts (no forced alignment); scene lengths come from the real audio."""
import importlib.util, json, os, subprocess, sys, wave
from multiprocessing import Pool
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SCREENS, AUDIO = os.path.join(HERE, 'screens'), os.path.join(HERE, 'audio')
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(HERE, 'out')
WORK = os.path.join(OUT, 'work'); os.makedirs(WORK, exist_ok=True)
spec = importlib.util.spec_from_file_location('content', os.path.join(HERE, 'content.py')); content = importlib.util.module_from_spec(spec); spec.loader.exec_module(content)
SCENES = content.SCENES; DUR = json.load(open(os.path.join(AUDIO, 'durations.json')))

W, H, FPS = 1920, 1080, 24
LEAD, TAIL, FLIP, XFADE = 0.5, 0.1, 0.5, 0.25
SERIF = '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'; SERIFB = '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'
MONO = '/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf'; MONOB = '/usr/share/fonts/truetype/liberation/LiberationMono-Bold.ttf'
F = lambda p, s: ImageFont.truetype(p, s)
PAPER, GRID, MARGIN, INK, PENCIL, GREEN = (233, 241, 229), (205, 222, 200), (200, 80, 80), (36, 52, 44), (196, 48, 48), (46, 125, 80)
RX0, RY0, RX1, RY1 = 150, 40, 1800, 850          # content region; note band below it, caption box under that
FULL = {'title_card', 'workflow_today_vs_governed', 'phases_timeline', 'controls_table', 'planted_vs_found', 'guardrails_diagram',
        'architecture_diagram', 'bugs_found_table', 'signoff_block_founder'}   # pre-rendered workpaper pages (1920x1080)
CHAT = (200, 0, 1030, 618)                       # crop of the 1236x618 browser captures: the chat column only, no scrollbar
SPEC = {   # crop = source box; focus = fixed point of the slow push (fraction of crop); z = push; ticks/underlines in source pixels
 'chat_01_controls': dict(crop=CHAT, focus=(.2, .35), z=.12),
 'chat_02_ac01_top': dict(crop=CHAT, focus=(.2, .6), z=.12, ticks=[(442, 384), (410, 449), (493, 516)]),
 'chat_03_ac01_exceptions': dict(crop=CHAT, focus=(.4, .75), z=.15, ticks=[(735, 446)]),
 'chat_04_je01': dict(crop=CHAT, focus=(.35, .75), z=.15, ticks=[(648, 444), (452, 298)]),
 'chat_05_cm01': dict(crop=CHAT, focus=(.4, .75), z=.15, ticks=[(652, 445)],
                      note='Note: the prose lists 5 of the 7 transports; the facts block under the answer is authoritative.'),
 'chat_06_refusal': dict(crop=CHAT, focus=(.4, .8), z=.15, under=[(252, 625, 468)]),
 'evidence_pdf_p1': dict(crop=(60, 70, 1060, 770), focus=(.5, .5), z=.08, ticks=[(650, 270), (908, 389), (982, 547)]),
}
DEFAULT_Z = .08

def ease(x): x = min(1, max(0, x)); return x * x * (3 - 2 * x)

# ---------- paper, tabs ----------
_base = {}
def base(tab):
    if tab in _base: return _base[tab]
    im = Image.new('RGB', (W, H), PAPER); d = ImageDraw.Draw(im)
    for x in range(120, W, 60): d.line([(x, 0), (x, H)], fill=GRID, width=1)
    for y in range(40, H, 54): d.line([(0, y), (W, y)], fill=GRID, width=1)
    d.line([(110, 0), (110, H)], fill=MARGIN, width=3)
    for i in range(1, 12):
        y = 40 + (i - 1) * 90; on = (tab == i)
        d.rectangle([W - (46 if on else 30), y, W, y + 74], fill=(255, 255, 255) if on else (214, 228, 210), outline=GRID)
        d.text((W - 24, y + 22), f'{i}', font=F(MONOB, 22), fill=INK if on else (120, 140, 125), anchor='mt')
    _base[tab] = im; return im

# ---------- shots ----------
_src, _plate = {}, {}
def geom(name):
    if name in _src: return _src[name]
    im = Image.open(os.path.join(SCREENS, name + ('.png' if os.path.exists(os.path.join(SCREENS, name + '.png')) else '.jpg'))).convert('RGB')
    sp = dict(SPEC.get(name, {}))
    if name in FULL:   # drop margin line + tab column (we draw our own), keep the page down to its last ink
        a = np.asarray(im).astype(int); dark = (a[:, 125:1700].sum(2) < 450).sum(1); last = int(np.nonzero(dark)[0].max())
        sp.setdefault('crop', (115, 0, 1862, min(H, last + 40))); sp.setdefault('z', .05); cap = 1.0
    else:
        sp.setdefault('crop', (0, 0, im.width, im.height)); sp.setdefault('z', DEFAULT_Z); cap = 1.5
    sp.setdefault('focus', (.5, .5))
    cx0, cy0, cx1, cy1 = sp['crop']; cw, ch = cx1 - cx0, cy1 - cy0
    s0 = min((RX1 - RX0) / cw, (RY1 - RY0) / ch, cap); pw, ph = round(cw * s0), round(ch * s0)
    px, py = RX0 + (RX1 - RX0 - pw) // 2, RY0 + (RY1 - RY0 - ph) // 2
    _src[name] = (im, sp, pw, ph, px, py); return _src[name]

def plate(name, tab):
    k = (name, tab)
    if k not in _plate:
        im, sp, pw, ph, px, py = geom(name); p = base(tab).copy(); d = ImageDraw.Draw(p)
        d.rectangle([px + 9, py + 9, px + pw + 9, py + ph + 9], fill=(176, 196, 174))
        d.rectangle([px - 3, py - 3, px + pw + 2, py + ph + 2], fill=(255, 255, 255), outline=INK, width=3)
        _plate[k] = p
    return _plate[k]

def tick(d, x, y, k, p):   # red-pencil tick, drawn progressively; p in 0..1
    pts = [(x, y), (x + 14 * k, y + 20 * k), (x + 44 * k, y - 26 * k)]; l1 = 24.4 * k; l2 = 52.5 * k; cur = p * (l1 + l2); w = max(4, round(5.5 * k))
    if cur <= l1: f = cur / l1; d.line([pts[0], (pts[0][0] + (pts[1][0] - pts[0][0]) * f, pts[0][1] + (pts[1][1] - pts[0][1]) * f)], fill=PENCIL, width=w)
    else:
        f = (cur - l1) / l2; d.line([pts[0], pts[1]], fill=PENCIL, width=w)
        d.line([pts[1], (pts[1][0] + (pts[2][0] - pts[1][0]) * f, pts[1][1] + (pts[2][1] - pts[1][1]) * f)], fill=PENCIL, width=w)

def shot_frame(name, tab, ts, dur):
    im, sp, pw, ph, px, py = geom(name); cx0, cy0, cx1, cy1 = sp['crop']; cw, ch = cx1 - cx0, cy1 - cy0
    z = 1 + sp['z'] * ease(ts / max(dur, .01)); bw, bh = cw / z, ch / z; fx, fy = sp['focus']
    bx, by = cx0 + fx * (cw - bw), cy0 + fy * (ch - bh)
    out = plate(name, tab).copy(); out.paste(im.resize((pw, ph), Image.LANCZOS, box=(bx, by, bx + bw, by + bh)), (px, py)); d = ImageDraw.Draw(out)
    sx = pw / bw; k = max(.8, sx / 1.35)
    m = lambda x, y: (px + (x - bx) * sx, py + (y - by) * sx)
    for j, (x, y) in enumerate(sp.get('ticks', [])):
        p = (ts - (1.0 + .9 * j)) / .3
        if p > 0:
            X, Y = m(x, y)
            if px < X < px + pw - 60 and py < Y < py + ph: tick(d, X, Y + 10 * (1 - min(1, p)) * -1, k, min(1, p))
    for j, (x0, x1, y) in enumerate(sp.get('under', [])):
        p = (ts - (1.0 + .9 * j)) / .5
        if p > 0:
            (X0, Y), (X1, _) = m(x0, y), m(x1, y); d.line([(X0, Y), (X0 + (X1 - X0) * min(1, p), Y + 3)], fill=PENCIL, width=max(4, round(4 * k)))
    if sp.get('note'):
        f = F(SERIF, 24); tw = d.textlength(sp['note'], font=f)
        d.rounded_rectangle([RX0, 858, RX0 + tw + 40, 896], 6, fill=(255, 253, 242), outline=PENCIL, width=2); d.text((RX0 + 20, 877), sp['note'], font=f, fill=PENCIL, anchor='lm')
    return out

# ---------- captions ----------
def wrap(d, text, font, width):
    out, line = [], ''
    for w in text.split(' '):
        t = (line + ' ' + w).strip()
        if d.textlength(t, font=font) <= width: line = t
        else: out.append(line); line = w
    return out + [line]
_cap = {}
def caption(sc, k):
    key = (sc['id'], k)
    if key in _cap: return _cap[key]
    d0 = ImageDraw.Draw(Image.new('RGB', (10, 10))); f = F(SERIF, 30); lines = wrap(d0, sc['sentences'][k][0], f, 1466)
    h = 24 + len(lines) * 38 + 18; im = Image.new('RGB', (1640, h), (255, 253, 242)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, 1639, h - 1], outline=INK, width=2); d.rectangle([0, 0, 9, h], fill=PENCIL)
    d.text((28, 22), f"{sc['ref']}.{k + 1}", font=F(MONOB, 24), fill=PENCIL)
    for j, ln in enumerate(lines): d.text((150, 20 + j * 38), ln, font=f, fill=INK)
    _cap[key] = im; return im

# ---------- timeline ----------
def timeline(i):
    sc = SCENES[i]; dur = DUR[sc['id']]; total = dur + LEAD + TAIL
    ch = [len(s[1]) for s in sc['sentences']]; cum = np.cumsum([0] + ch) / sum(ch) * dur + LEAD
    ns, nsent = len(sc['shots']), len(sc['sentences'])
    if ns <= nsent: bounds = [0.0] + [float(cum[round(k * nsent / ns)]) for k in range(1, ns)] + [total]
    else: bounds = [total * k / ns for k in range(ns + 1)]
    return sc, total, cum, bounds

def scene_frame(i, t):
    sc, total, cum, bounds = timeline(i); tab = int(sc['nav'].split('-')[1]); ns = len(sc['shots'])
    def at(k, tt): return shot_frame(sc['shots'][k], tab, max(0, tt - bounds[k]), bounds[k + 1] - bounds[k])
    k = max(0, min(ns - 1, int(np.searchsorted(bounds, t, side='right')) - 1)); im = None
    if k + 1 < ns and t >= bounds[k + 1] - XFADE / 2: im = Image.blend(at(k, t), at(k + 1, t), (t - (bounds[k + 1] - XFADE / 2)) / XFADE)
    elif k > 0 and t < bounds[k] + XFADE / 2: im = Image.blend(at(k - 1, t), at(k, t), (t - (bounds[k] - XFADE / 2)) / XFADE)
    if im is None: im = at(k, t)
    if LEAD <= t < total - TAIL:
        s = min(len(cum) - 2, int(np.searchsorted(cum, t, side='right')) - 1); c = caption(sc, s)
        im.paste(c, (150, 1050 - c.height))
    return im

_strip = None
def flip(prev, cur, p):
    global _strip
    e = ease(p); w = int((W - 110) * (1 - e)); out = cur.copy()
    if w < 3: return out
    out.paste(prev.crop((110, 0, W, H)).resize((w, H), Image.BILINEAR), (110, 0)); d = ImageDraw.Draw(out)
    x = 110 + w; d.line([(x, 0), (x, H)], fill=(90, 110, 95), width=3)
    if _strip is None: _strip = Image.linear_gradient('L').rotate(270).resize((40, H)).point(lambda v: int(v * .28))   # dark at the fold, fading right
    out.paste(Image.new('RGB', (40, H), (30, 45, 35)), (x + 2, 0), _strip)
    return out

def render_scene(i):
    sc, total, cum, bounds = timeline(i); n = round(total * FPS); path = os.path.join(WORK, f'seg{i:02d}.mp4')
    prev = scene_frame(i - 1, timeline(i - 1)[1] - 1 / FPS) if i > 0 else None
    p = subprocess.Popen(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                          '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-g', str(FPS * 2), '-an', path], stdin=subprocess.PIPE)
    for f in range(n):
        t = f / FPS; im = scene_frame(i, t)
        if prev is not None and t < FLIP: im = flip(prev, im, t / FLIP)
        p.stdin.write(im.tobytes())
    p.stdin.close(); assert p.wait() == 0; return path, n

def build_audio(path):
    first = wave.open(os.path.join(AUDIO, SCENES[0]['id'] + '.wav')); params = first.getparams(); first.close(); sr, sw, nch = params.framerate, params.sampwidth, params.nchannels
    out = wave.open(path, 'wb'); out.setparams(params)
    for i, sc in enumerate(SCENES):
        w = wave.open(os.path.join(AUDIO, sc['id'] + '.wav')); assert w.getparams()[:3] == (nch, sw, sr), 'wav format differs'; data = w.readframes(w.getnframes()); w.close()
        frames = round(timeline(i)[1] * FPS) / FPS; need = round(frames * sr); lead = round(LEAD * sr)
        out.writeframes(b'\0' * (lead * sw * nch) + data + b'\0' * (max(0, need - lead - len(data) // (sw * nch)) * sw * nch))
    out.close()

if __name__ == '__main__':
    with Pool(min(4, os.cpu_count() or 1)) as pool: segs = pool.map(render_scene, range(len(SCENES)))
    lst = os.path.join(WORK, 'segs.txt'); open(lst, 'w').write(''.join(f"file '{p}'\n" for p, _ in segs))
    wav = os.path.join(WORK, 'narration.wav'); build_audio(wav)
    master = os.path.join(OUT, 'sox-demo.mp4')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
                    '-movflags', '+faststart', '-shortest', master], check=True)
    print('wrote', master, sum(n for _, n in segs) / FPS, 's')
