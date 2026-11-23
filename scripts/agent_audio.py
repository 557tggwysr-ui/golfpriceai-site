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


def soundtrack(style, script, dur, out_wav):
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
        for k, (_, j, t0, t1, ln) in enumerate(lines):
            last = k == len(lines) - 1
            if k == 0 and len(lines) > 1:
                add(fx, tada(), t0 + .05, .8)  # the claim
            elif last:
                add(fx, rimshot(), t0 + .6, .9)  # the punchline
            else:
                quiet.append((t0, t1))  # the mate's deadpan look: silence
        if script.get("outro"):
            add(fx, chime(), end + .1, .8)
    elif style in ("humour", "headline"):
        add(fx, rimshot(), 3.0, .6)

    k = 0
    while k * BEAT < dur:
        at = k * BEAT
        add(music, kick() * .9 if k % 2 == 0 else snare() * .6, at)
        add(music, hat(), at + BEAT / 2)
        if k % 2 == 0:
            c = CHORDS[(k // 2) % 4]
            for j, f in enumerate(c): add(music, pluck(f), at + j * .05)
            add(music, pluck(c[0] / 2, 1.0) * 1.2, at)
        k += 1
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
