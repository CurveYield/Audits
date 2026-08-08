from __future__ import annotations
import json, os, sys
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM
RESULTS=[]; CONSOLE=[]
def record(name,passed,details=""):
    RESULTS.append({"name":name,"passed":bool(passed),"details":details}); print(("PASS" if passed else "FAIL"),name,details,flush=True)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=CHROMIUM,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":1440,"height":1024})
    page.on('console',lambda m: CONSOLE.append(f"{m.type}: {m.text}"[:2000]) if len(CONSOLE)<100 else None)
    load_app(page,route="#/admin"); page.wait_for_selector('.developer-log'); page.wait_for_timeout(200)
    details=page.evaluate("() => ({innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth})")
    record('desktop Admin has no page overflow',max(details['documentWidth'],details['bodyWidth'])<=details['innerWidth']+1,details)
    page.locator('.admin-filters select[name="chain"]').select_option('fraxtal'); page.locator('.admin-filters button[type="submit"]').click(); page.wait_for_timeout(80)
    cards=page.locator('.admin-card h2').all_inner_texts()
    record('Fraxtal Admin filter displays only sdFXS',cards==['sdFXS'],cards)
    page.locator('[data-action="reset-diagnostic-filters"]').click(); page.wait_for_timeout(50)
    record('all scoped Admin cards return in approved order',page.locator('.admin-card h2').all_inner_texts()==['sdCRV','sdFXN','sdFXS'],page.locator('.admin-card h2').all_inner_texts())
    page.screenshot(path=str(OUT/'admin-1440x1024-v3.png'),full_page=True)
    page.close()
    summary={"version":3,"suite":"admin-desktop","passed":sum(r['passed'] for r in RESULTS),"failed":sum(not r['passed'] for r in RESULTS),"results":RESULTS,"console":CONSOLE}
    (OUT/'browser-admin-desktop-results-v3.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({"suite":"admin-desktop","passed":summary['passed'],"failed":summary['failed']}),flush=True)
    sys.stdout.flush();sys.stderr.flush();os._exit(1 if summary['failed'] else 0)
