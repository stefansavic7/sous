"""Assembles the final demo video: cards + simulator recording + original music, under 10 MB."""
import json
import subprocess
import sys
from pathlib import Path

OUT = Path("out")
raw = Path(Path(OUT / "demo_raw_path.txt").read_text().strip())
if not raw.is_absolute():
    raw = Path(__file__).resolve().parent.parent / raw


def run(*args):
    subprocess.run(args, check=True)


def probe_duration(p: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(p)],
                       capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


FPS = 30
FADE = 0.45
segments = []

def card(name: str, seconds: float):
    out = OUT / f"seg_{name}.mp4"
    run("ffmpeg", "-loglevel", "error", "-y", "-loop", "1", "-t", str(seconds), "-i", str(OUT / "cards" / f"{name}.png"),
        "-vf", f"fps={FPS},format=yuv420p,fade=t=in:st=0:d={FADE},fade=t=out:st={seconds - FADE}:d={FADE}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", str(out))
    segments.append(out)

trim_start = float(sys.argv[1]) if len(sys.argv) > 1 else 2.2
raw_dur = probe_duration(raw)
demo_len = raw_dur - trim_start - 0.4

card("title", 5.0)
card("problem", 6.0)
demo = OUT / "seg_demo.mp4"
run("ffmpeg", "-loglevel", "error", "-y", "-ss", str(trim_start), "-t", str(demo_len), "-i", str(raw),
    "-vf", f"fps={FPS},format=yuv420p,fade=t=in:st=0:d={FADE},fade=t=out:st={demo_len - FADE}:d={FADE}",
    "-c:v", "libx264", "-preset", "medium", "-crf", "16", str(demo))
segments.append(demo)
card("how", 11.0)
card("end", 7.0)

concat_list = OUT / "concat.txt"
concat_list.write_text("".join(f"file '{p.resolve()}'\n" for p in segments))
joined = OUT / "joined.mp4"
run("ffmpeg", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(concat_list), "-c", "copy", str(joined))
total = probe_duration(joined)

music = OUT / "music.wav"
run(sys.executable, "music.py", f"{total:.2f}", str(music))

final = OUT / "sous-demo.mp4"
audio_kbps = 64
budget_bits = 9.3 * 1024 * 1024 * 8
video_kbps = int(budget_bits / total / 1000 - audio_kbps)
common = ["-i", str(joined), "-i", str(music), "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "slow",
          "-b:v", f"{video_kbps}k", "-maxrate", f"{video_kbps * 3}k", "-bufsize", f"{video_kbps * 6}k",
          "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
run("ffmpeg", "-loglevel", "error", "-y", *common, "-pass", "1", "-passlogfile", str(OUT / "x264"), "-an", "-f", "mp4", "/dev/null")
run("ffmpeg", "-loglevel", "error", "-y", *common, "-pass", "2", "-passlogfile", str(OUT / "x264"),
    "-c:a", "aac", "-b:a", f"{audio_kbps}k", "-shortest", str(final))
size = final.stat().st_size / 1024 / 1024
print(json.dumps({"final": str(final), "seconds": round(total, 1), "MB": round(size, 2), "video_kbps": video_kbps}))
