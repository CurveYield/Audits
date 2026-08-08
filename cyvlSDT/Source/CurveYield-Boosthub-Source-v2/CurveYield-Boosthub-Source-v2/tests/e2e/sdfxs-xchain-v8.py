from __future__ import annotations
import json
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM

results=[]
def add(name, passed, details=''):
    results.append({'name':name,'passed':bool(passed),'details':details})

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':390,'height':844})
    load_app(page, route='#/locker/sdfxs')
    metrics=page.locator('.detail-metrics').inner_text()
    body=page.locator('body').inner_text()
    add('sdFXS shows the populated StakeDAO default staking APR', '9.01%' in metrics and 'StakeDAO rate without vlSDT boost' in metrics, metrics)
    add('sdFXS retained-stake multiplier is populated without unsolicited XChain explanation', '1.93x' in metrics and 'XChain gauge distributes rewards uniformly; no working-balance boost' not in metrics, metrics)
    add('sdFXS vault APY remains populated', '18.99%' in metrics, metrics)
    add('sdFXS page does not expose unavailable yield placeholders', 'DEFAULT APR\n--' not in metrics and 'BOOSTHUB APY\n--' not in metrics and 'BOOST MULTIPLIER\n--' not in metrics, metrics)
    overflow=page.evaluate('() => ({inner:innerWidth, doc:document.documentElement.scrollWidth, body:document.body.scrollWidth})')
    add('sdFXS mobile page has no horizontal overflow', max(overflow['doc'],overflow['body']) <= overflow['inner']+1, overflow)
    add('sdFXS contract links remain present', 'STAKING CONTRACT' in body and 'COMPOUNDING VAULT' in body and 'COMPOUNDING STRATEGY' in body, body[-1800:])
    page.screenshot(path=str(OUT/'locker-sdfxs-390x844-v11.png'), full_page=True)
    page.set_viewport_size({'width':1440,'height':1024})
    page.wait_for_timeout(150)
    page.screenshot(path=str(OUT/'locker-sdfxs-1440x1024-v11.png'), full_page=True)
    browser.close()

summary={'suite':'sdfxs-xchain-v11','passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'results':results}
(OUT/'sdfxs-xchain-results-v11.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
for r in results: print(('PASS' if r['passed'] else 'FAIL'), r['name'])
print(json.dumps({'passed':summary['passed'],'failed':summary['failed']}))
raise SystemExit(1 if summary['failed'] else 0)
