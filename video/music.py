"""Generates an original, gentle background track (no samples, no copyrighted material)."""
import sys, wave
import numpy as np

SR = 44100
dur = float(sys.argv[1]) if len(sys.argv) > 1 else 140.0
out = sys.argv[2] if len(sys.argv) > 2 else "out/music.wav"
bpm = 84
beat = 60 / bpm
bar = 4 * beat
t = np.arange(int(dur * SR)) / SR
mix = np.zeros_like(t)

def note(f):
    return 440.0 * 2 ** ((f - 69) / 12)

# I–vi–IV–V in C with extensions: Cmaj9, Am9, Fmaj7(#11), G6sus
chords = [[48, 55, 59, 62, 64], [45, 52, 55, 59, 60], [41, 48, 52, 57, 59], [43, 50, 55, 57, 62]]
arps = [[72, 76, 79, 74], [69, 72, 76, 71], [65, 69, 72, 71], [67, 71, 74, 69]]

rng = np.random.default_rng(7)
nbars = int(np.ceil(dur / bar))
for b in range(nbars):
    start = b * bar
    ch = chords[b % 4]
    i0 = int(start * SR)
    n = int((bar + 1.5) * SR)
    seg_t = np.arange(n) / SR
    env = np.minimum(1, seg_t / 1.2) * np.exp(-np.maximum(0, seg_t - bar) / 0.6)
    pad = np.zeros(n)
    for k, m in enumerate(ch):
        f = note(m)
        for det in (-0.12, 0.0, 0.12):
            ff = f * 2 ** (det / 12)
            pad += np.sin(2 * np.pi * ff * seg_t + rng.uniform(0, 6.28)) * (0.5 if k == 0 else 0.32)
    pad *= env * 0.05
    j = min(len(mix), i0 + n)
    mix[i0:j] += pad[: j - i0]
    # soft plucked arpeggio on eighth notes, skipping some for air
    ar = arps[b % 4]
    for e in range(8):
        if e in (3, 7) and b % 2 == 0:
            continue
        s0 = start + e * beat / 2
        k0 = int(s0 * SR)
        m = ar[e % 4] + (12 if e >= 4 and b % 4 == 3 else 0)
        f = note(m)
        ln = int(1.4 * SR)
        tt = np.arange(ln) / SR
        pl = (np.sin(2 * np.pi * f * tt) + 0.25 * np.sin(4 * np.pi * f * tt)) * np.exp(-tt * 3.2) * np.minimum(1, tt / 0.006)
        pl *= 0.045 * (0.8 + 0.2 * rng.random())
        kk = min(len(mix), k0 + ln)
        if k0 < len(mix):
            mix[k0:kk] += pl[: kk - k0]
    # warm bass on beats 1 and 3
    for e in (0, 2):
        s0 = start + e * beat
        k0 = int(s0 * SR)
        f = note(ch[0] - 12)
        ln = int(1.6 * SR)
        tt = np.arange(ln) / SR
        bs = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 1.6) * np.minimum(1, tt / 0.02) * 0.07
        kk = min(len(mix), k0 + ln)
        if k0 < len(mix):
            mix[k0:kk] += bs[: kk - k0]

# gentle echo, fades, normalize to about -16 dBFS peak
d = int(beat * 0.75 * SR)
echo = np.zeros_like(mix)
echo[d:] = mix[:-d] * 0.28
mix = mix + echo
fade_in, fade_out = int(2.0 * SR), int(3.5 * SR)
mix[:fade_in] *= np.linspace(0, 1, fade_in)
mix[-fade_out:] *= np.linspace(1, 0, fade_out)
mix = mix / (np.max(np.abs(mix)) + 1e-9) * 10 ** (-16 / 20)
pcm = (mix * 32767).astype(np.int16)
with wave.open(out, "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print("wrote", out, f"{dur:.1f}s")
