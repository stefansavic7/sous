import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
OUT = Path("out/cards"); OUT.mkdir(parents=True, exist_ok=True)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={"width": 1920, "height": 1080})
        for card in ["title", "problem", "how", "end"]:
            await pg.goto(f"file://{Path('cards.html').resolve()}#{card}")
            await pg.reload()
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=str(OUT / f"{card}.png"))
        await b.close()
asyncio.run(main())
