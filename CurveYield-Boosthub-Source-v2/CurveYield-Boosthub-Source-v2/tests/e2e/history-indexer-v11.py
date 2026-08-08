from __future__ import annotations
import json
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM

results=[]
def add(name, passed, details=''):
    results.append({'name':name,'passed':bool(passed),'details':details})

remote_fetch = r'''(() => {
  const priorFetch = window.fetch;
  window.fetch = async (input, init) => {
    const url = String(input?.url || input || '');
    if (url.startsWith('https://boosthub-data.curveyield.online/history/sdcrv')) {
      return new Response(JSON.stringify({
        lockerId: 'sdcrv', range: '7d', resolutionMs: 900000,
        points: [
          { observedAt: 1786032000000, stakedaoDefaultAprBps: 1200, boosthubVaultApyBps: 3100, stakedaoSource: 'https://api.stakedao.org/api/lockers/', vaultApySource: 'boost-range-compounded', blockNumber: 24000000 },
          { observedAt: 1786118400000, stakedaoDefaultAprBps: 1250, boosthubVaultApyBps: 3200, stakedaoSource: 'https://api.stakedao.org/api/lockers/', vaultApySource: 'boost-range-compounded', blockNumber: 24005000 }
        ]
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return priorFetch(input, init);
  };
})()'''

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':1024})
    load_app(page, route='#/locker/sdcrv', extra_prelude_js=remote_fetch)
    page.wait_for_function("() => document.querySelector('.yield-history-panel')?.innerText.includes('2 observations')", timeout=30000)
    panel=page.locator('.yield-history-panel').inner_text()
    svg=page.locator('.yield-history-panel svg.yield-chart')
    add('remote D1 history renders instead of the empty local fallback', svg.count() == 1 and '2 observations' in panel, panel)
    add('chart exposes exactly the requested two yield-series labels', 'BoostHub Vault APY' in panel and 'StakeDAO Default APR' in panel, panel)
    add('chart renders both remote line paths', page.locator('.vault-apy-series').count() == 1 and page.locator('.staking-apr-series').count() == 1)
    browser.close()

summary={'suite':'history-indexer-v11','passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'results':results}
(OUT/'history-indexer-results-v11.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
for r in results: print(('PASS' if r['passed'] else 'FAIL'), r['name'], r['details'] if not r['passed'] else '')
print(json.dumps({'passed':summary['passed'],'failed':summary['failed']}))
raise SystemExit(1 if summary['failed'] else 0)
