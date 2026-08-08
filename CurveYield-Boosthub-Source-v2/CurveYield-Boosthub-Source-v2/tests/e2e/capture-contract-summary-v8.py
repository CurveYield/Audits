from __future__ import annotations

import json
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM

results = []

def add(name, passed, details=''):
    results.append({'name': name, 'passed': bool(passed), 'details': details})

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1440, 'height': 1024})
    load_app(page, route='#/locker/sdcrv')
    cards = page.locator('.contract-summary-item')
    strategy = cards.filter(has_text='Compounding strategy')
    vault_href = cards.filter(has_text='Compounding vault').locator('.primary-contract-link').get_attribute('href')
    strategy_href = strategy.locator('.primary-contract-link').get_attribute('href')
    add('sdCRV has staking, vault, and strategy contract entries', cards.count() == 3, cards.all_inner_texts())
    add('sdCRV replacement vault link is rendered', '0xdb6aa572243b9617c4b39fb20468843b2cb97ba5' in vault_href.lower(), vault_href)
    add('sdCRV replacement strategy link is rendered', '0x93dfefefd5d3736381086efa5a8810f278138adf' in strategy_href.lower(), strategy_href)
    page.screenshot(path=str(OUT / 'locker-sdcrv-1440x1024-v11.png'), full_page=True)
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_timeout(120)
    overflow = page.evaluate("() => ({ inner: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })")
    add('sdCRV contract summary has no mobile horizontal overflow', max(overflow['document'], overflow['body']) <= overflow['inner'] + 1, overflow)
    copy_box = strategy.locator('.copy-address').bounding_box()
    add('strategy copy control remains usable on mobile', bool(copy_box and copy_box['height'] >= 24), copy_box)
    page.screenshot(path=str(OUT / 'locker-sdcrv-390x844-v11.png'), full_page=True)
    browser.close()

payload = {'version': 11, 'passed': sum(item['passed'] for item in results), 'failed': sum(not item['passed'] for item in results), 'results': results}
(OUT / 'contract-summary-results-v11.json').write_text(json.dumps(payload, indent=2), encoding='utf-8')
print(json.dumps(payload, indent=2))
raise SystemExit(1 if payload['failed'] else 0)
