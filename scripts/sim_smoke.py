"""Headless smoke test of the Alexa+ simulator: talks to Alexa and screenshots the smart display."""
import asyncio
import sys
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3020/"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp"


async def say(pg, text, wait=2500):
    await pg.fill("#sayInput", text)
    await pg.press("#sayInput", "Enter")
    await pg.wait_for_timeout(wait)


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1440, "height": 860})
        logs = []
        pg.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        pg.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))
        await pg.goto(URL, wait_until="networkidle")
        await pg.wait_for_timeout(1500)
        await say(pg, "I'm making salmon, rice and broccoli for 7", 3500)
        await pg.screenshot(path=f"{OUT}/sim1.png")
        await say(pg, "what's next?")
        await pg.screenshot(path=f"{OUT}/sim2.png")
        print("\n".join(l for l in logs[-40:] if "Download the React DevTools" not in l))
        print("---- transcript ----")
        print(await pg.inner_text("#transcript"))
        print("---- status ----")
        print(await pg.inner_text("#connStatus"))
        await b.close()


asyncio.run(main())
