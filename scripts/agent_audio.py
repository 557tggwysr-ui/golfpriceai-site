"""Soundtracks for the content engine's videos: an original backing beat at 100 bpm (every cut
lands on a beat) and a few golf sound effects, in moderation. Everything is synthesised here,
so there's no licensing and nothing borrowed: trending sounds are still added by hand in the
TikTok and Instagram apps when the pack suggests one (mute "original audio" there).

    soundtrack(style, script, dur, out_wav) -> out_wav (or None if numpy is missing)
"""
import wave

try:
    import numpy as np
except ImportError:  # the video still renders, just silent
    np = None

SR = 44100
BEAT = 0.6
CHORDS = [(196, 247, 294), (165, 196, 247), (131, 165, 196), (147, 185, 220)]  # G, Em, C, D


def _env(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def _noise(n, seed):
    return np.random.RandomState(seed).randn(n)


def _sweep(n, f0, f1, k):
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t * k)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


# ---- the band
def kick():
    n = int(.35 * SR); return _sweep(n, 140, 50, 30) * _env(n, .002, .12)
def snare():
    n = int(.18 * SR); return _noise(n, 2) * _env(n, .001, .05) * .5 + np.sin(2 * np.pi * 190 * np.arange(n) / SR) * _env(n, .001, .06) * .4
def hat():
    n = int(.06 * SR); return _noise(n, 1) * _env(n, .001, .015) * .25
def pluck(f, l=.9):
    n = int(l * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + .4 * np.sin(4 * np.pi * f * t) + .2 * np.sin(6 * np.pi * f * t)) * _env(n, .004, .18) * .22


# ---- golf and comedy effects
def thwack(big=False):  # club on ball: a sharp click, a short crack of noise, a low thump
    n = int(.25 * SR)
    s = _noise(n, 3) * _env(n, .0005, .012) * 1.1 + _sweep(n, 1800, 900, 60) * _env(n, .0005, .02) * .5 + _sweep(n, 160, 70, 25) * _env(n, .002, .07) * .6
    if big:  # a driver: a whoosh just before the strike
        w = int(.22 * SR); wh = _noise(w, 7) * np.sin(np.linspace(0, np.pi, w)) ** 2 * .35
        s = np.concatenate([wh, s])
    return s
def splash():  # wedge through sand
    n = int(.45 * SR); return _noise(n, 4) * _env(n, .004, .12) * .55 * np.linspace(1, .4, n)
def tock():  # putter on ball
    n = int(.12 * SR); return _sweep(n, 1300, 1100, 20) * _env(n, .0005, .02) * .6 + _noise(n, 5) * _env(n, .0005, .004) * .4
def cup():  # ball rattling into the cup
    out = np.zeros(int(.45 * SR))
    for i, (at, f) in enumerate([(0, 900), (.09, 760), (.16, 680), (.21, 640)]):
        n = int(.1 * SR); j = int(at * SR); out[j:j + n] += _sweep(n, f, f, 1) * _env(n, .0005, .025) * (.5 - i * .08)
    return out
def tada():  # a little brass-ish flourish
    out = np.zeros(int(.9 * SR))
    for at, f, l in [(0, 392, .12), (.12, 523, .6)]:
        n = int(l * SR); t = np.arange(n) / SR; j = int(at * SR)
        tone = sum(np.sin(2 * np.pi * f * k * t) / k for k in (1, 2, 3, 4))
        out[j:j + n] += tone * _env(n, .01, .35) * .25
    return out
def rimshot():  # ba-dum-tss
    out = np.zeros(int(1.0 * SR))
    k, sn = kick() * .9, snare() * .5
    both = k.copy(); both[:len(sn)] += sn
    for at, s in [(0, snare() * .9), (.16, both)]:
        j = int(at * SR); out[j:j + len(s)] += s
    n = int(.6 * SR); j = int(.32 * SR); out[j:j + n] += _noise(n, 9) * _env(n, .001, .25) * .35
    return out
def chime():  # the outro: a bright two-note bell
    out = np.zeros(int(1.4 * SR))
    for at, f in [(0, 784), (.15, 1175)]:
        n = int(1.1 * SR); t = np.arange(n) / SR; j = int(at * SR)
        out[j:j + n] += (np.sin(2 * np.pi * f * t) + .3 * np.sin(2 * np.pi * f * 2.76 * t)) * _env(n, .002, .4) * .25
    return out


def _shot_sfx(label):
    l = (label or "").lower()
    if "putt" in l: return tock()
    if "wedge" in l or "bunker" in l or "sand" in l:
        s = splash(); t = thwack() * .5; s[:len(t)] += t; return s
    if "driver" in l: return thwack(big=True)
    if any(k in l for k in ("wood", "iron", "hybrid", "rescue")): return thwack()
    return None


# ---- the bands: six grooves at 100 bpm (cuts still land on the beat), in five keys.
# The Fourball keeps its own theme (the one John signed off on), so the series is recognisable;
# everything else rotates by day, so two days running never share a groove.
GROOVES = ["clubhouse", "bossa", "funk", "chip", "lofi", "oompah"]
KEYS = [1.0, 2 ** (2 / 12), 2 ** (-3 / 12), 2 ** (5 / 12), 2 ** (-5 / 12)]  # G, A, E, C, D


def groove_for(style, script, seed):
    if style == "sequence":
        return ("clubhouse", 1.0)
    key = str(seed or "")
    try:  # pid starts with the date: the groove follows the day, so neighbours always differ
        from datetime import date
        n = date.fromisoformat(key[:10]).toordinal()
    except ValueError:
        n = sum(map(ord, key))
    rot = [g for g in GROOVES if g != "clubhouse"] + ["clubhouse"]
    return (rot[n % len(rot)], KEYS[(n * 7 + len(key)) % len(KEYS)])


def _tone(f, l, harm=(1, .4, .2), a=.004, d=.18, gain=.22):
    n = int(l * SR); t = np.arange(n) / SR
    return sum(h * np.sin(2 * np.pi * f * (k + 1) * t) for k, h in enumerate(harm)) * _env(n, a, d) * gain
def _square(f, l, gain=.08):
    n = int(l * SR); t = np.arange(n) / SR
    return np.sign(np.sin(2 * np.pi * f * t)) * _env(n, .002, l / 3) * gain
def _rhodes(f, l=1.1):
    n = int(l * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + .25 * np.sin(2 * np.pi * f * 3 * t) * np.exp(-t * 6)) * (1 + .25 * np.sin(2 * np.pi * 5 * t)) * _env(n, .01, .5) * .16
def _clap():
    n = int(.2 * SR); x = np.zeros(n)
    for i, at in enumerate((0, .012, .024)):
        j = int(at * SR); m = n - j; x[j:] += _noise(m, 20 + i) * _env(m, .0005, .03 if i < 2 else .08) * .4
    return x
def _rim():
    n = int(.05 * SR); return _tone(1700, .05, (1,), .0003, .008, .5) + _noise(n, 31) * _env(n, .0003, .005) * .3
def _shaker():
    n = int(.09 * SR); return _noise(n, 33) * np.sin(np.linspace(0, np.pi, n)) * .12
def _crackle(dur):
    n = int(dur * SR); x = np.zeros(n); r = np.random.RandomState(5)
    for i in r.randint(0, n, int(dur * 30)): x[i] = r.uniform(-.25, .25)
    return x + _noise(n, 6) * .006
def _tuba(f, l=.28):
    return _tone(f, l, (1, .6, .3, .15), .01, .12, .3)


PROG = {  # four-bar chord loops, root notes in Hz (in G before transposing)
    "clubhouse": [(196, 247, 294), (165, 196, 247), (131, 165, 196), (147, 185, 220)],
    "bossa": [(196, 247, 294, 370), (220, 262, 330, 392), (147, 185, 220, 262), (196, 247, 294, 370)],
    "funk": [(196, 233, 294), (196, 233, 294), (262, 311, 392), (233, 294, 349)],
    "chip": [(196, 247, 294), (220, 262, 330), (175, 220, 262), (147, 185, 220)],
    "lofi": [(165, 196, 247, 294), (131, 165, 196, 247), (147, 185, 220, 262), (110, 139, 165, 196)],
    "oompah": [(196, 247, 294), (147, 185, 220), (196, 247, 294), (147, 185, 220)],
}


def band(music, dur, g, add):
    name, key = g
    prog = [[f * key for f in c] for c in PROG[name]]
    k = 0
    if name == "lofi":
        add(music, _crackle(dur), 0)
    while k * BEAT < dur:
        at, c = k * BEAT, prog[(k // 2) % 4]
        if name == "clubhouse":
            add(music, kick() * .9 if k % 2 == 0 else snare() * .6, at); add(music, hat(), at + BEAT / 2)
            if k % 2 == 0:
                for j, f in enumerate(c[:3]): add(music, pluck(f), at + j * .05)
                add(music, pluck(c[0] / 2, 1.0) * 1.2, at)
        elif name == "bossa":
            add(music, kick() * .6, at)
            for off in (0, .3 * BEAT, .75 * BEAT): add(music, _rim(), at + off)
            for off in (0, .25, .5, .75): add(music, _shaker(), at + off * BEAT)
            if k % 2 == 0:
                for j, f in enumerate(c): add(music, _tone(f, .5, (1, .3), .003, .2, .12), at + .35 * BEAT + j * .01)
                add(music, _tone(c[0] / 2, .5, (1, .2), .005, .25, .35), at)
            else:
                add(music, _tone(c[0] * 3 / 4, .4, (1, .2), .005, .2, .3), at)
        elif name == "funk":
            add(music, kick(), at)
            if k % 2: add(music, _clap() * .9, at)
            for off in (.25, .5, .75): add(music, hat() * (1.3 if off == .5 else .8), at + off * BEAT)
            for off, mul in ((0, 1), (.75, 1), (.5, 2)):  # a syncopated octave bass
                add(music, _tone(c[0] / 2 * mul, .14, (1, .5, .25), .003, .06, .45), at + off * BEAT)
            if k % 2 == 1:
                for f in c: add(music, _tone(f * 2, .12, (1, .5, .3, .2), .002, .05, .07), at + .5 * BEAT)
        elif name == "chip":  # an 8-bit arcade bounce, Wild Nine's world
            add(music, kick() * .7, at) if k % 2 == 0 else add(music, _noise(int(.05 * SR), 40) * _env(int(.05 * SR), .0005, .02) * .35, at)
            arp = [c[0], c[1], c[2], c[1] * 2]
            for j in range(4): add(music, _square(arp[j] * 2, .14), at + j * BEAT / 4)
            if k % 2 == 0: add(music, _square(c[0] / 2, BEAT * 1.8, .09), at)
        elif name == "lofi":
            add(music, kick() * .55, at) if k % 2 == 0 else add(music, snare() * .3, at + .03)
            add(music, hat() * .5, at + BEAT / 2 + .02)
            if k % 2 == 0:
                for f in c: add(music, _rhodes(f), at + .02)
                add(music, _tone(c[0] / 2, 1.0, (1, .1), .02, .5, .3), at)
        elif name == "oompah":  # a comedy march
            add(music, _tuba(c[0] / 2 if k % 2 == 0 else c[2] / 2), at)
            add(music, _tone(c[1], .15, (1, .5, .3), .003, .06, .12) + 0, at + BEAT / 2)
            add(music, snare() * .35, at + BEAT / 2)
            if k % 8 == 7:
                for j in range(4): add(music, snare() * .25, at + j * BEAT / 8)
        k += 1


def soundtrack(style, script, dur, out_wav, seed=None):
    if np is None:
        return None
    N = int(dur * SR)
    music = np.zeros(N + 2 * SR)
    fx = np.zeros(N + 2 * SR)

    def add(buf, s, at, gain=1.0):
        if s is None or at < 0: return
        i = int(at * SR); s = s[:len(buf) - i]; buf[i:i + len(s)] += s * gain

    quiet = []  # (start, end): the music drops out for a deadpan beat
    if style == "sequence":
        from agent_brush import _seq_plan, OUTRO
        plan, end = _seq_plan(script)
        shots = [p for p in plan if p[0] == "shot" and not p[4].get("cutaway")]
        for k, (_, i, t0, t1, sh) in enumerate(shots):
            add(fx, _shot_sfx(sh.get("label")), t0 + .05)
            if k == len(shots) - 1 and "putt" in (sh.get("label") or "").lower():
                add(fx, cup(), t0 + .35, .9)  # the tap-in drops
        lines = [p for p in plan if p[0] == "line"]
        punch = max([k for k, p in enumerate(lines) if (p[4].get("text") or "").strip()] or [len(lines) - 1])
        for k, (_, j, t0, t1, ln) in enumerate(lines):
            if k == 0 and len(lines) > 1:
                add(fx, tada(), t0 + .05, .8)  # the claim
            elif k == punch:
                add(fx, rimshot(), t0 + .6, .9)  # the punchline
        # The music drops out for one deadpan beat only, never for a run of lines: a wordless reaction
        # before the punchline (Kev trying not to laugh), or else the last beat before the punchline.
        # (Until 26 Nov 2026 every middle line went silent, so longer episodes lost the band for seconds.)
        dead = [p for p in lines[1:punch] if not (p[4].get("text") or "").strip()]
        if dead:
            quiet += [(p[2], p[3]) for p in dead]
        elif 0 < punch - 1:
            quiet.append((max(lines[punch - 1][2], lines[punch][2] - BEAT), lines[punch][2]))
        if script.get("outro"):
            add(fx, chime(), end + .1, .8)
    elif style in ("humour", "headline"):
        add(fx, rimshot(), 3.0, .6)

    band(music, dur, groove_for(style, script, seed), add)
    for a, b in quiet:  # fade the band out and back in around the deadpan beat
        i, j, r = int(a * SR), int(b * SR), int(.08 * SR)
        music[i:j] *= 0
        music[max(0, i - r):i] *= np.linspace(1, 0, min(r, i))
        music[j:j + r] *= np.linspace(0, 1, len(music[j:j + r]))
    x = music * .45 + fx
    x = x[:N]
    fade = int(.6 * SR); x[-fade:] *= np.linspace(1, 0, fade); x[:int(.02 * SR)] *= np.linspace(0, 1, int(.02 * SR))
    x = x / (np.max(np.abs(x)) or 1) * .85
    with wave.open(str(out_wav), "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype(np.int16).tobytes())
    return out_wav
