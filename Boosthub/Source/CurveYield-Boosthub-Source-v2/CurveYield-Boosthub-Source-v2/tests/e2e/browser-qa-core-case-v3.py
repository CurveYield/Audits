from __future__ import annotations

import json
import sys
from playwright.sync_api import sync_playwright, Page
from render_harness_v10 import load_app, CHROMIUM


def no_page_overflow(page: Page):
    details = page.evaluate("""() => ({innerWidth, documentWidth:document.documentElement.scrollWidth, bodyWidth:document.body.scrollWidth})""")
    return max(details["documentWidth"], details["bodyWidth"]) <= details["innerWidth"] + 1, details


def pointer_box(page: Page, selector: str):
    return page.locator(selector).first.evaluate("""el => { const r=el.getBoundingClientRect(); return {width:r.width,height:r.height,text:el.textContent.trim()}; }""")


def add(results, name, passed, details=""):
    results.append({"name": name, "passed": bool(passed), "details": details})


def run_case(case: str):
    results=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True, executable_path=CHROMIUM, args=["--no-sandbox","--disable-dev-shm-usage"])
        try:
            if case.startswith('viewport:'):
                width,height=map(int,case.split(':')[1].split('x'))
                page=browser.new_page(viewport={"width":width,"height":height}); load_app(page,route="#/")
                passed,details=no_page_overflow(page); add(results,f"overview reflows at {width}x{height}",passed,details)
            elif case=='text200':
                page=browser.new_page(viewport={"width":320,"height":800}); load_app(page,route="#/")
                page.add_style_tag(content="html { font-size: 200% !important; }"); page.wait_for_timeout(100)
                passed,details=no_page_overflow(page); add(results,"320px layout survives 200% text sizing",passed,details)
            elif case=='home':
                page=browser.new_page(viewport={"width":1440,"height":1024}); load_app(page,route="#/")
                row_symbols=page.locator(".locker-row .locker-token strong").all_inner_texts()
                add(results,"home locker order is sdCRV, sdFXN, sdFXS",row_symbols==["sdCRV","sdFXN","sdFXS"],row_symbols)
                add(results,"home separates staking and vault rewards",page.locator(".reward-column-label",has_text="Staking Rewards").count()==3 and page.locator(".reward-column-label",has_text="Vault Rewards").count()==3)
                page.locator('.locker-row[aria-label*="sdFXN"] .boost-cell').click(); page.wait_for_function("location.hash === '#/locker/sdfxn'"); page.wait_for_selector('h1:has-text("sdFXN BoostHub")')
                add(results,"clicking any locker row area opens its locker",page.locator("h1",has_text="sdFXN BoostHub").count()==1)
            elif case.startswith('locker:'):
                locker_id,symbol=case.split(':')[1].split(',')
                page=browser.new_page(viewport={"width":390,"height":844}); load_app(page,route=f"#/locker/{locker_id}")
                text=page.locator('.detail-metrics').inner_text()
                add(results,f"{symbol} yield and multiplier values render","%" in text and "x" in text and "Unavailable" not in text,text)
                add(results,f"{symbol} has staking and vault modules",page.locator('.action-module').count()==2)
                staking_card=page.locator('.contract-summary-item').filter(has_text='Staking contract')
                interaction=staking_card.locator('.primary-contract-link')
                href=interaction.get_attribute('href') if interaction.count() else ''
                expected_host='explorer.mainnet.frax.com' if locker_id == 'sdfxs' else 'eth.blockscout.com'
                add(results,f"{symbol} staking link uses Blockscout Read/Write",interaction.count()==1 and expected_host in href and 'tab=read_write_contract' in href,href)
                passed,details=no_page_overflow(page); add(results,f"{symbol} locker reflows at 390x844",passed,details)
            elif case=='modal':
                page=browser.new_page(viewport={"width":390,"height":844}); load_app(page,route="#/locker/sdcrv",with_wallet=True)
                staking_buttons=page.locator('.staking-module .action-buttons button')
                add(results,"disconnected staking panel has one wallet CTA",staking_buttons.count()==1 and staking_buttons.first.inner_text().strip()=="Connect Wallet")
                page.locator('#connectWallet').click(); page.wait_for_selector('#walletModal:not([hidden])')
                inside=lambda: page.evaluate("document.activeElement && document.querySelector('#walletModal').contains(document.activeElement)")
                add(results,"wallet modal moves focus inside",inside())
                for _ in range(12): page.keyboard.press('Tab')
                add(results,"wallet modal traps focus",inside())
                page.keyboard.press('Escape'); page.wait_for_timeout(50)
                add(results,"wallet modal restores trigger",page.locator('#walletModal').is_hidden() and page.evaluate("document.activeElement?.id==='connectWallet'"))
                back=pointer_box(page,'.back-link'); source_box=pointer_box(page,'.primary-contract-link')
                add(results,"back link meets 24px pointer target",back['height']>=24 and back['width']>=24,back)
                add(results,"Read Write link meets 24px pointer target",source_box['height']>=24 and source_box['width']>=24,source_box)
            elif case=='switch':
                page=browser.new_page(viewport={"width":390,"height":844}); load_app(page,route="#/locker/sdfxs",with_wallet=True)
                page.evaluate("""() => { const original=window.ethereum.request.bind(window.ethereum); let reject=true; window.ethereum.request=async(args)=>{ if(args?.method==='wallet_switchEthereumChain' && reject){ reject=false; window.__walletCalls.push({method:'wallet_switchEthereumChain',params:args.params||[]}); const e=new Error('User rejected'); e.code=4001; throw e; } return original(args); }; }""")
                page.locator('#connectWallet').click(); page.locator('[data-wallet-key]').first.click(); page.wait_for_timeout(350)
                calls=page.evaluate("window.__walletCalls.filter(x=>x.method==='wallet_switchEthereumChain').length")
                add(results,"wrong-chain connection automatically prompts wallet switch",calls>=1,calls)
                page.wait_for_selector('[data-action="switch-chain"]'); page.locator('[data-action="switch-chain"]').click(); page.wait_for_timeout(300)
                add(results,"manual network recovery switches to Fraxtal",page.locator('#networkIndicator').inner_text().strip()=="Fraxtal",page.locator('#networkIndicator').inner_text())
            elif case=='offline-event':
                page=browser.new_page(viewport={"width":390,"height":844}); load_app(page,route="#/")
                page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,value:false}); window.dispatchEvent(new Event('offline')); ")
                add(results,"offline event shows Connection Offline notice",page.locator('#offlineIndicator').is_visible() and page.locator('#offlineIndicator').inner_text()=="Connection Offline")
                page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,value:true}); window.dispatchEvent(new Event('online')); ")
                add(results,"online event hides offline notice",page.locator('#offlineIndicator').is_hidden())
            else:
                raise ValueError(f'unknown case {case}')
        finally:
            browser.close()
    return results

if __name__=='__main__':
    case=sys.argv[1]
    try:
        results=run_case(case)
        print(json.dumps({"case":case,"results":results}))
        raise SystemExit(1 if any(not r['passed'] for r in results) else 0)
    except Exception as exc:
        print(json.dumps({"case":case,"error":repr(exc),"results":[]}))
        raise
