from __future__ import annotations
import json, mimetypes, os
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright
from render_harness_v10 import ROOT, OUT, CHROMIUM

RESULTS=[]
def record(name,passed,details=""):
    RESULTS.append({"name":name,"passed":bool(passed),"details":details}); print(("PASS" if passed else "FAIL"),name,details,flush=True)

ORIGIN='https://curveyield-offline.test'

def local_response(route):
    parsed=urlparse(route.request.url)
    if parsed.netloc != 'curveyield-offline.test':
        route.fulfill(status=503,content_type='application/json',body='{"error":"offline fixture"}')
        return
    rel=parsed.path.lstrip('/') or 'index.html'
    path=(ROOT/rel).resolve()
    try:
        path.relative_to(ROOT.resolve())
    except ValueError:
        route.fulfill(status=403,body='forbidden'); return
    if not path.is_file():
        path=ROOT/'index.html'
    mime=mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    route.fulfill(status=200,content_type=mime,body=path.read_bytes())

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=CHROMIUM,args=['--no-sandbox','--disable-dev-shm-usage'])
    context=browser.new_context(viewport={"width":390,"height":844},service_workers='allow')
    context.route('**/*',local_response)
    page=context.new_page(); page.goto(f'{ORIGIN}/',wait_until='domcontentloaded'); page.wait_for_selector('.overview',timeout=30000)
    page.evaluate("navigator.serviceWorker.ready")
    page.reload(wait_until='domcontentloaded'); page.wait_for_selector('.overview',timeout=30000)
    controlled=page.evaluate("Boolean(navigator.serviceWorker.controller)")
    caches=page.evaluate("caches.keys()")
    record('service worker controls the installed app',controlled,{'controlled':controlled,'caches':caches})
    record('versioned v3 application shell cache exists','curveyield-boosthub-shell-v3' in caches,caches)
    context.unroute('**/*',local_response)
    context.set_offline(True); page.reload(wait_until='domcontentloaded'); page.wait_for_selector('.overview',timeout=30000)
    record('application shell reloads while browser is offline',page.locator('.overview').count()==1)
    record('offline reload displays Connection Offline',page.locator('#offlineIndicator').is_visible(),page.locator('#offlineIndicator').inner_text() if page.locator('#offlineIndicator').count() else '')
    page.screenshot(path=str(OUT/'offline-shell-390x844-v3.png'),full_page=True)
    context.set_offline(False); context.close(); browser.close()

summary={"version":3,"suite":"offline","passed":sum(r['passed'] for r in RESULTS),"failed":sum(not r['passed'] for r in RESULTS),"results":RESULTS,"console":[]}
(OUT/'browser-offline-results-v3.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({"suite":"offline","passed":summary['passed'],"failed":summary['failed']}),flush=True)
os._exit(1 if summary['failed'] else 0)
