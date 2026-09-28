"""Records the Sous demo in the Alexa+ simulator (1920x1080), with narration captions.

Usage: python3 video/record.py http://127.0.0.1:3020/ video/out
"""
import asyncio
import json
import sys
import time
from pathlib import Path
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020/?t=18:05"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "video/out")
OUT.mkdir(parents=True, exist_ok=True)

CAPTION_CSS = """
#narr { position: fixed; left: 31.5%; bottom: 30px; transform: translateX(-50%); z-index: 9999;
  width: max-content; max-width: 1080px; padding: 16px 28px; border-radius: 18px; background: rgba(8,10,12,.86);
  color: #fff; font: 600 30px/1.3 Inter, system-ui, sans-serif; text-align: center;
  box-shadow: 0 10px 40px rgba(0,0,0,.45); opacity: 0; transition: opacity .35s ease; pointer-events: none; }
#narr.show { opacity: 1; }
#narr small { display: block; font-weight: 500; font-size: 20px; color: #9fb4c3; margin-top: 4px; }
.foot { display: none !important; }
"""

marks = []  # (seconds since start, caption) for the subtitle file
T0 = 0.0


async def narrate(pg, text, sub=""):
    marks.append((time.time() - T0, text))
    await pg.evaluate(
        """([t, s]) => { let n = document.getElementById('narr');
        if (!n) { n = document.createElement('div'); n.id = 'narr'; document.body.append(n); }
        n.innerHTML = ''; n.append(document.createTextNode(t));
        if (s) { const x = document.createElement('small'); x.textContent = s; n.append(x); }
        n.classList.add('show'); }""",
        [text, sub],
    )


async def hide_narration(pg):
    await pg.evaluate("() => document.getElementById('narr')?.classList.remove('show')")


async def say(pg, text, pause=1.2):
    await pg.click("#sayInput")
    await pg.locator("#sayInput").press_sequentially(text, delay=38)
    await asyncio.sleep(0.35)
    await pg.press("#sayInput", "Enter")
    await asyncio.sleep(pause)


def screen_frame(pg):
    return pg.frame_locator("#screen iframe.view >> nth=-1")


async def wait_text(pg, needle, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if needle.lower() in (await pg.inner_text("#transcript")).lower():
            return True
        await asyncio.sleep(0.2)
    return False


async def main():
    global T0
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--force-color-profile=srgb"])
        ctx = await browser.new_context(
            viewport={"width": 1920, "height": 1080},
            record_video_dir=str(OUT / "raw"),
            record_video_size={"width": 1920, "height": 1080},
            timezone_id="America/New_York",
            locale="en-US",
        )
        pg = await ctx.new_page()
        await pg.goto(URL, wait_until="networkidle")
        await pg.add_style_tag(content=CAPTION_CSS)
        await pg.uncheck("#voice")
        T0 = time.time()
        await asyncio.sleep(1.5)

        await narrate(pg, "Sous is an Alexa+ skill that runs dinner, so every dish is ready at the same time.")
        await asyncio.sleep(4.5)
        await narrate(pg, "Tell Alexa what you're cooking and when you want to eat.")
        await say(pg, "I'm making salmon, rice and broccoli, dinner in 40 minutes", pause=2.5)
        await narrate(pg, "Sous plans backwards from dinner time around one cook, four burners and one oven.",
                      "The broccoli roasts at the salmon's temperature so both fit in the oven.")
        await asyncio.sleep(7)

        await narrate(pg, "Then Alexa walks you through it and speaks each step on time.", "Demo clock running at 60×")
        await pg.click("#warp button[data-rate='60']")
        # Tap Done on the Echo Show when there's something to do.
        tapped = False
        end = time.time() + 20
        while time.time() < end and not tapped:
            try:
                btn = screen_frame(pg).locator("#doneBtn")
                if await btn.is_visible():
                    await asyncio.sleep(0.8)
                    await narrate(pg, "Tap Done on the screen, or just say it.")
                    await btn.click()
                    tapped = True
                    break
            except Exception:
                pass
            await asyncio.sleep(0.3)
        await asyncio.sleep(5)

        await narrate(pg, "Fall behind? Sous reshuffles what hasn't started and keeps what's already cooking.")
        await pg.click("#warp button[data-rate='1']")
        await say(pg, "I'm running 10 minutes late", pause=5)
        await pg.click("#warp button[data-rate='60']")
        await narrate(pg, "Cues keep coming until everything lands together.")
        await wait_text(pg, "Dinner is ready", timeout=70)
        await asyncio.sleep(2.5)
        await pg.click("#warp button[data-rate='1']")

        await narrate(pg, "No time given? Sous asks through MCP elicitation.")
        await say(pg, "Plan dinner: steak, mashed potatoes and green beans", pause=2.2)
        await say(pg, "7:30", pause=4)
        await narrate(pg, "Everything underneath is real MCP: Streamable HTTP, spec 2025-11-25, tools, elicitation and an MCP Apps view.")
        await pg.click(".traffic summary")
        await asyncio.sleep(1)
        await pg.evaluate("() => { const t = document.getElementById('traffic'); t.scrollTop = t.scrollHeight; }")
        await asyncio.sleep(6)
        await pg.click(".traffic summary")

        await narrate(pg, "It learns family recipes too: steps, times and oven temperatures from plain text.")
        await pg.click("#chips button[data-say='Add a recipe']")
        await asyncio.sleep(1.2)
        await pg.fill("#recipeName", "Grandma's stuffed peppers")
        await pg.locator("#recipeText").press_sequentially(
            "Preheat the oven to 375°F.\nCook the rice for 15 minutes.\nStuff the peppers with rice and beef.\nBake for 45 minutes.", delay=18)
        await asyncio.sleep(0.6)
        await pg.click("#recipeForm button[value='save']")
        await asyncio.sleep(4)
        await say(pg, "We're having grandma's stuffed peppers and a garden salad at 8", pause=6)
        await hide_narration(pg)
        await asyncio.sleep(1)
        duration = time.time() - T0
        await ctx.close()
        await browser.close()

    raw = sorted((OUT / "raw").glob("*.webm"), key=lambda f: f.stat().st_mtime)[-1]
    (OUT / "demo_raw_path.txt").write_text(str(raw))
    (OUT / "marks.json").write_text(json.dumps({"duration": duration, "marks": marks}, indent=1))
    print("recorded", raw, f"{duration:.1f}s", "tapped done:", tapped)


asyncio.run(main())
