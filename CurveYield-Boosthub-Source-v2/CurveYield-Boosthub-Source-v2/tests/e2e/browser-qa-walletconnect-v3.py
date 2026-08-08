from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM

RESULTS=[]

def record(name, passed, details=""):
    RESULTS.append({"name":name,"passed":bool(passed),"details":details})
    print(("PASS" if passed else "FAIL"), name, details, flush=True)

def walletconnect_fake() -> str:
    return r"""
(() => {
  window.CURVEYIELD_RUNTIME_CONFIG = { walletConnectProjectId: 'test-project-id', walletConnectScriptUrls: [] };
  const listeners = new Map();
  const account = '0x1234567890abcdef1234567890abcdef12345678';
  const provider = {
    accounts: [], session: null,
    async connect() { this.accounts=[account]; this.session={topic:'fixture-topic'}; (listeners.get('connect')||[]).forEach(fn=>fn({chainId:'0x1'})); (listeners.get('accountsChanged')||[]).forEach(fn=>fn(this.accounts)); return this.accounts; },
    async request(args) { const method=args?.method||''; if(method==='eth_accounts'||method==='eth_requestAccounts') return this.accounts; if(method==='eth_chainId') return '0x1'; if(method==='net_version') return '1'; if(method==='eth_blockNumber') return '0x123456'; if(method==='eth_getBalance'||method==='eth_getTransactionCount') return '0x0'; if(method==='eth_call') return '0x'+'0'.repeat(64); if(method==='eth_estimateGas') return '0x5208'; return '0x0'; },
    on(name, fn) { const list=listeners.get(name)||[]; list.push(fn); listeners.set(name,list); },
    async disconnect() { this.accounts=[]; this.session=null; (listeners.get('disconnect')||[]).forEach(fn=>fn({code:6000})); },
  };
  window['@walletconnect/ethereum-provider'] = { EthereumProvider: { init: async () => provider } };
})();
"""

with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True, executable_path=CHROMIUM, args=["--no-sandbox","--disable-dev-shm-usage"])
    page=browser.new_page(viewport={"width":390,"height":844})
    load_app(page, route="#/", extra_prelude_js=walletconnect_fake())
    page.locator("#connectWallet").click(); page.wait_for_selector("#walletModal:not([hidden])")
    record("configured WalletConnect describes QR/mobile pairing", "Scan a QR code" in page.locator("[data-walletconnect]").inner_text())
    page.locator("[data-walletconnect]").click(no_wait_after=True)
    page.wait_for_function("document.querySelector('#connectWallet span:last-child').textContent.trim() !== 'Connect Wallet'", timeout=30000)
    record("WalletConnect provider connects through the common wallet path", page.locator("#connectWallet span:last-child").inner_text().strip() != "Connect Wallet" and page.locator("#networkIndicator").inner_text().strip() == "Ethereum", {"wallet":page.locator("#connectWallet").inner_text(),"network":page.locator("#networkIndicator").inner_text()})
    page.screenshot(path=str(OUT / "walletconnect-connected-390x844-v3.png"), full_page=False)
    page.close()
    summary={"version":3,"suite":"walletconnect","passed":sum(r["passed"] for r in RESULTS),"failed":sum(not r["passed"] for r in RESULTS),"results":RESULTS,"console":[]}
    Path(OUT / "browser-walletconnect-results-v3.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print(json.dumps({"suite": "walletconnect", "passed": summary["passed"], "failed": summary["failed"]}), flush=True)
    sys.stdout.flush(); sys.stderr.flush(); os._exit(1 if summary["failed"] else 0)
