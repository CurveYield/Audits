from __future__ import annotations
import json
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM

NEW = '0xdb6aa572243b9617c4b39fb20468843b2cb97ba5'
RESULTS = []


def check(name, passed, details=''):
    RESULTS.append({'name': name, 'passed': bool(passed), 'details': details})
    print(('PASS' if passed else 'FAIL'), name, details, flush=True)


def sent_calls(page):
    return page.evaluate("window.__walletCalls.filter(x=>x.method==='eth_sendTransaction').map(x=>x.params?.[0]||{})")


def connect(page, *, preapproved=False):
    load_app(page, route='#/locker/sdcrv', with_wallet=True, auto_accounts=True)
    if preapproved:
        page.evaluate('window.__returnMaxRpcCalls=true; window.__returnMaxCalls=true')
    page.locator('#connectWallet').click()
    page.locator('[data-wallet-key]').first.click()
    page.wait_for_timeout(1000)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox', '--disable-dev-shm-usage'])

    # Scenario 1: no allowance. Prove the ERC-20 approval encodes the new vault as spender.
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    connect(page)
    vault = page.locator('.vault-module')
    vault.locator('[data-amount-input]').fill('1')
    vault.locator('[data-action="deposit"]').click()
    page.wait_for_selector('#confirmationModal:not([hidden])')
    check('approval modal belongs to sdCRV vault deposit', 'Approve sdCRV' in page.locator('#confirmationModal').inner_text())
    page.locator('#confirmationModal [data-confirm-submit]').click()
    page.wait_for_timeout(500)
    calls = sent_calls(page)
    approval = calls[-1] if calls else {}
    approval_data = (approval.get('data') or '').lower()
    check('vault approval encodes the replacement vault as spender', NEW[2:] in approval_data, approval)
    page.close()

    # Scenario 2: preapproved allowance. Prove the actual deposit is sent to the new vault.
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    connect(page, preapproved=True)
    page.wait_for_function("window.__fetchCalls.some(entry => String(entry.requestBody || '').toLowerCase().includes('db6aa572243b9617c4b39fb20468843b2cb97ba5'))", timeout=10000)
    rpc_batches = page.evaluate('window.__fetchCalls.map(entry => entry.requestBody).filter(Boolean)')
    rpc_items = []
    for body in rpc_batches:
        try:
            parsed = json.loads(body)
            rpc_items.extend(parsed if isinstance(parsed, list) else [parsed])
        except Exception:
            pass
    vault_reads = [item for item in rpc_items if str(item.get('method', '')).lower() == 'eth_call' and str((item.get('params') or [{}])[0].get('to', '')).lower() == NEW]
    selectors = {str((item.get('params') or [{}])[0].get('data', ''))[:10].lower() for item in vault_reads}
    check('wallet share and PPS reads target the replacement vault', {'0x70a08231', '0x77c7b8fc'}.issubset(selectors), sorted(selectors))
    allowance_calls = [item for item in rpc_items if str(item.get('method', '')).lower() == 'eth_call' and str((item.get('params') or [{}])[0].get('data', '')).lower().startswith('0xdd62ed3e')]
    check('vault allowance read encodes the replacement vault as spender', any(NEW[2:] in str((item.get('params') or [{}])[0].get('data', '')).lower() for item in allowance_calls), allowance_calls)
    vault = page.locator('.vault-module')
    vault.locator('[data-amount-input]').fill('1')
    page.wait_for_timeout(100)
    check('preapproved vault flow skips the approval modal', vault.locator('[data-action="deposit"]').inner_text() == 'Review Deposit')
    vault.locator('[data-action="deposit"]').click()
    page.wait_for_selector('#confirmationModal:not([hidden])')
    modal_text = page.locator('#confirmationModal').inner_text()
    check('deposit confirmation shows replacement vault short address', '0xdb6a' in modal_text.lower(), modal_text)
    page.locator('#confirmationModal [data-confirm-submit]').click()
    page.wait_for_timeout(500)
    calls = sent_calls(page)
    deposit = calls[-1] if calls else {}
    check('sdCRV deposit transaction targets replacement vault', (deposit.get('to') or '').lower() == NEW, deposit)
    page.close()

    # Scenario 3: prove the actual share withdrawal is sent to the new vault.
    page = browser.new_page(viewport={'width': 1280, 'height': 900})
    connect(page, preapproved=True)
    vault = page.locator('.vault-module')
    vault.locator('[data-mode="withdraw"]').click()
    vault.locator('[data-amount-input]').fill('1')
    vault.locator('[data-action="withdraw"]').click()
    page.wait_for_selector('#confirmationModal:not([hidden])')
    modal_text = page.locator('#confirmationModal').inner_text()
    check('withdrawal confirmation shows replacement vault short address', '0xdb6a' in modal_text.lower(), modal_text)
    page.locator('#confirmationModal [data-confirm-submit]').click()
    page.wait_for_timeout(500)
    calls = sent_calls(page)
    withdrawal = calls[-1] if calls else {}
    check('sdCRV withdrawal transaction targets replacement vault', (withdrawal.get('to') or '').lower() == NEW, withdrawal)
    page.close()

    browser.close()

summary = {
    'suite': 'vault-targets-v11',
    'passed': sum(r['passed'] for r in RESULTS),
    'failed': sum(not r['passed'] for r in RESULTS),
    'results': RESULTS,
}
(OUT / 'vault-targets-results-v11.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps({'passed': summary['passed'], 'failed': summary['failed']}))
raise SystemExit(1 if summary['failed'] else 0)
