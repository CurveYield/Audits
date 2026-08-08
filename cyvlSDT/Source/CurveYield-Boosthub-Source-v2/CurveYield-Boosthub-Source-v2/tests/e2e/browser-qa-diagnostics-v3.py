from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, Page
from render_harness_v10 import load_app, OUT, CHROMIUM

RESULTS=[]; CONSOLE=[]
def record(name,passed,details=""):
    RESULTS.append({"name":name,"passed":bool(passed),"details":details}); print(("PASS" if passed else "FAIL"),name,details,flush=True)
def no_overflow(page:Page):
    d=page.evaluate("() => ({innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth})")
    return max(d['documentWidth'],d['bodyWidth'])<=d['innerWidth']+1,d

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={"width":390,"height":844},accept_downloads=True)
    page.on('console',lambda m: CONSOLE.append(f"{m.type}: {m.text}"[:2000]) if len(CONSOLE)<160 else None)
    load_app(page,route="#/admin",diagnostic_count=575); page.wait_for_selector('.developer-log'); page.wait_for_timeout(250)
    passed,details=no_overflow(page); record('mobile Admin has no page overflow',passed,details)
    metrics=page.locator('.error-log-list').evaluate("el=>({clientHeight:el.clientHeight,scrollHeight:el.scrollHeight,right:el.getBoundingClientRect().right,viewport:innerWidth,overflowY:getComputedStyle(el).overflowY})")
    record('diagnostic list is bounded and internally scrollable',metrics['scrollHeight']>metrics['clientHeight'] and metrics['right']<=metrics['viewport']+1,metrics)
    record('default diagnostic page displays 200 records',page.locator('.error-log-entry').count()==200,page.locator('.error-log-entry').count())
    sizes=page.locator('[data-diagnostic-page-size] option').all_inner_texts()
    record('diagnostic page sizes are 50, 100, 200, 500',sizes==['50','100','200','500'],sizes)
    filters={
      'chains':page.locator('.admin-filters select[name="chain"] option').all_inner_texts(),
      'statuses':page.locator('.admin-filters select[name="status"] option').all_inner_texts(),
      'authorization':page.locator('.admin-filters select[name="authorization"]').count(),
    }
    record('Admin filters use only approved chains and statuses',filters['chains']==['All','Ethereum','Fraxtal'] and filters['statuses']==['All','Healthy','Problem'] and filters['authorization']==0,filters)
    record('Admin contract search is predefined and transaction hash is separate',page.locator('.admin-filters select[name="contractAddress"]').count()==1 and page.locator('.admin-filters input[name="transactionHash"]').count()==1)
    record('repeated error exposes occurrence timeline',page.locator('.occurrence-timeline').count()>=1,page.locator('.occurrence-timeline').first.inner_text()[:180] if page.locator('.occurrence-timeline').count() else '')
    record('storage health data is present on Admin',page.locator('.storage-health-panel').count()==1 and 'IndexedDB' in page.locator('.storage-health-panel').inner_text())
    controls=['copy-diagnostics','export-diagnostics','retest-rpc','inspect-cache','clear-cache','retry-reads','clear-errors','inspect-storage']
    record('Admin exposes approved diagnostic controls',all(page.locator(f'[data-action="{x}"]').count()==1 for x in controls),controls)

    # Transaction-hash search is exact enough to isolate one fixture.
    tx='0x'+f'{1:064x}'
    page.locator('.admin-filters input[name="transactionHash"]').fill(tx)
    page.locator('.admin-filters button[type="submit"]').click(); page.wait_for_timeout(80)
    record('transaction-hash filter isolates matching record',page.locator('.error-log-entry').count()==1,page.locator('.diagnostic-result-count').inner_text())
    page.locator('[data-copy-error-id]').first.click(); page.wait_for_timeout(40)
    copied=page.evaluate("window.__copiedText||''")
    record('copy-one-error is redacted','[REDACTED]' in copied and 'fixture-secret' not in copied,copied[:180])

    page.locator('[data-action="reset-diagnostic-filters"]').click(); page.wait_for_timeout(50)
    page.locator('[data-diagnostic-page-size]').select_option('500'); page.wait_for_timeout(50)
    record('500-record page size renders first 500',page.locator('.error-log-entry').count()==500,page.locator('.error-log-entry').count())
    page.locator('[data-action="diagnostic-next"]').click(); page.wait_for_timeout(50)
    record('second 500-record page renders remaining 75',page.locator('.error-log-entry').count()==75,page.locator('.error-log-entry').count())

    page.locator('[data-action="reset-diagnostic-filters"]').click(); page.wait_for_timeout(50)
    sdfxs='0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183'
    page.locator('.admin-filters select[name="contractAddress"]').select_option(sdfxs)
    page.locator('.admin-filters button[type="submit"]').click(); page.wait_for_timeout(80)
    count=page.locator('.error-log-entry').count()
    record('predefined contract filter finds sdFXS records',count>0 and count<=200,count)

    page.locator('[data-action="reset-diagnostic-filters"]').click(); page.locator('[data-action="copy-diagnostics"]').click(); page.wait_for_timeout(50)
    copied_all=page.evaluate("window.__copiedText||''")
    record('complete diagnostics remain redacted and versioned','"version": 2' in copied_all and 'fixture-secret' not in copied_all and '[REDACTED]' in copied_all,copied_all[:180])
    with page.expect_download() as info: page.locator('[data-action="export-diagnostics"]').click()
    download=info.value; out=OUT/'downloaded-diagnostics-v3.json'; download.save_as(str(out)); exported=out.read_text()
    record('diagnostic JSON downloads and remains redacted','fixture-secret' not in exported and '[REDACTED]' in exported,download.suggested_filename)
    page.locator('[data-action="inspect-cache"]').click(); page.wait_for_selector('.cache-inspection')
    record('cache inspection shows local and IndexedDB layers','Local snapshot' in page.locator('.cache-inspection').inner_text() and 'IndexedDB snapshot' in page.locator('.cache-inspection').inner_text())
    page.locator('[data-action="retest-rpc"]').click(); page.wait_for_timeout(300)
    rpc_text=page.locator('.rpc-health-panel').inner_text()
    record('RPC details stay on Admin and show rotation plus timestamps','rotates in' in rpc_text and 'Last success:' in rpc_text,rpc_text[:260])
    page.screenshot(path=str(OUT/'admin-diagnostics-390x844-v3.png'),full_page=False)
    page.close()
    summary={"version":3,"suite":"diagnostics","passed":sum(r['passed'] for r in RESULTS),"failed":sum(not r['passed'] for r in RESULTS),"results":RESULTS,"console":CONSOLE}
    (OUT/'browser-diagnostics-results-v3.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    print(json.dumps({"suite":"diagnostics","passed":summary['passed'],"failed":summary['failed']}),flush=True)
    sys.stdout.flush();sys.stderr.flush();os._exit(1 if summary['failed'] else 0)
