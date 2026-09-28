"""Captures the README screenshot: the simulator mid-dinner, without demo captions."""
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={"width": 1600, "height": 900}, timezone_id="America/New_York", locale="en-US")
        pg = await ctx.new_page()
        await pg.goto("http://127.0.0.1:3020/?t=18:05", wait_until="networkidle")
        await pg.add_style_tag(content=".foot{display:none!important}")
        await pg.uncheck("#voice")
        await pg.fill("#sayInput", "I'm making salmon, rice and broccoli, dinner in 40 minutes")
        await pg.press("#sayInput", "Enter")
        await asyncio.sleep(2)
        await pg.click("#warp button[data-rate='60']")
        await asyncio.sleep(17)
        await pg.click("#warp button[data-rate='1']")
        await pg.fill("#sayInput", "What's next?")
        await pg.press("#sayInput", "Enter")
        await asyncio.sleep(3)
        await pg.screenshot(path="docs/screenshot.png")
        await b.close()

asyncio.run(main())
