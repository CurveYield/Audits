from __future__ import annotations

import json
from playwright.sync_api import sync_playwright, Page
from render_harness_v10 import load_app, OUT, CHROMIUM

RESULTS=[]

def record(name, passed, details=''):
    RESULTS.append({'name':name,'passed':bool(passed),'details':details})
    print(('PASS' if passed else 'FAIL'), name, details, flush=True)

def no_page_overflow(page: Page):
    details=page.evaluate("""() => ({innerWidth,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth})""")
    return max(details['documentWidth'],details['bodyWidth']) <= details['innerWidth']+1, details

def pointer_box(page: Page, selector: str):
    return page.locator(selector).first.evaluate("""el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,text:el.textContent.trim()}}""")

def route(page: Page, value: str):
    page.evaluate('(value)=>{location.hash=value}',value)
    page.wait_for_timeout(180)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path=CHROMIUM,args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':1024})
    load_app(page,route='#/',with_wallet=True)

    for width,height in [(320,568),(360,800),(390,844),(768,1024),(1024,768),(1366,768),(1440,1024),(1920,1080)]:
        page.set_viewport_size({'width':width,'height':height}); route(page,'#/')
        passed,details=no_page_overflow(page); record(f'overview reflows at {width}x{height}',passed,details)

    page.set_viewport_size({'width':320,'height':800}); route(page,'#/')
    page.add_style_tag(content='html { font-size: 200% !important; }'); page.wait_for_timeout(100)
    passed,details=no_page_overflow(page); record('320px layout survives 200% text sizing',passed,details)
    page.evaluate("document.querySelectorAll('style').forEach(s=>{if(s.textContent.includes('font-size: 200%'))s.remove()})")

    page.set_viewport_size({'width':1440,'height':1024}); route(page,'#/')
    row_symbols=page.locator('.locker-row .locker-token strong').all_inner_texts()
    record('home locker order is sdCRV, sdFXN, sdFXS',row_symbols==['sdCRV','sdFXN','sdFXS'],row_symbols)
    record('home separates staking and vault rewards',page.locator('.staking-reward-column').count()==3 and page.locator('.vault-reward-column').count()==3)
    page.locator('.locker-row[aria-label*="sdFXN"] .locker-performance').click(); page.wait_for_function("location.hash === '#/locker/sdfxn'"); page.wait_for_selector('h1:has-text("sdFXN Locker")')
    record('clicking any locker row area opens its locker',page.locator('h1',has_text='sdFXN Locker').count()==1)

    page.set_viewport_size({'width':390,'height':844})
    for locker_id,symbol in [('sdcrv','sdCRV'),('sdfxn','sdFXN'),('sdfxs','sdFXS')]:
        route(page,f'#/locker/{locker_id}')
        text=page.locator('.detail-metrics').inner_text()
        record(f'{symbol} yield and multiplier values render','%' in text and 'x' in text and 'Unavailable' not in text,text)
        record(f'{symbol} has staking and vault modules',page.locator('.action-module').count()==2)
        staking_card=page.locator('.contract-summary-item').filter(has_text='Staking contract')
        interaction=staking_card.locator('.primary-contract-link'); href=interaction.get_attribute('href') if interaction.count() else ''
        source=staking_card.locator('.contract-source-link')
        expected_host='explorer.mainnet.frax.com' if locker_id == 'sdfxs' else 'eth.blockscout.com'
        record(f'{symbol} staking link uses Blockscout Read/Write',interaction.count()==1 and expected_host in href and 'tab=read_write_contract' in href,href)
        record(f'{symbol} staking source is secondary',source.count()==1 and 'tab=contract' in (source.get_attribute('href') or ''),source.get_attribute('href') if source.count() else '')
        strategy_card=page.locator('.contract-summary-item').filter(has_text='Compounding strategy')
        strategy_href=strategy_card.locator('.primary-contract-link').get_attribute('href') if strategy_card.count() else ''
        record(f'{symbol} strategy contract link renders',strategy_card.count()==1 and 'tab=read_write_contract' in strategy_href,strategy_href)
        record(f'{symbol} contract summary contains staking, vault, and strategy',page.locator('.contract-summary-item').count()==3,page.locator('.contract-summary').inner_text())
        if locker_id == 'sdcrv':
            vault_href=page.locator('.contract-summary-item').filter(has_text='Compounding vault').locator('.primary-contract-link').get_attribute('href')
            record('sdCRV vault link uses replacement vault', '0xdb6aa572243b9617c4b39fb20468843b2cb97ba5' in vault_href.lower(), vault_href)
            record('sdCRV strategy link uses replacement strategy', '0x93dfefefd5d3736381086efa5a8810f278138adf' in strategy_href.lower(), strategy_href)
        passed,details=no_page_overflow(page); record(f'{symbol} locker reflows at 390x844',passed,details)

    route(page,'#/locker/sdcrv')
    staking_buttons=page.locator('.staking-module .action-buttons button')
    record('disconnected staking panel has one wallet CTA',staking_buttons.count()==1 and staking_buttons.first.inner_text().strip()=='Connect Wallet')
    page.locator('#connectWallet').click(); page.wait_for_selector('#walletModal:not([hidden])')
    inside=lambda: page.evaluate("document.activeElement && document.querySelector('#walletModal').contains(document.activeElement)")
    record('wallet modal moves focus inside',inside())
    for _ in range(12): page.keyboard.press('Tab')
    record('wallet modal traps focus',inside())
    page.keyboard.press('Escape'); page.wait_for_timeout(50)
    record('wallet modal restores trigger',page.locator('#walletModal').is_hidden() and page.evaluate("document.activeElement?.id==='connectWallet'"))
    back=pointer_box(page,'.back-link'); source_box=pointer_box(page,'.primary-contract-link')
    record('back link meets 24px pointer target',back['height']>=24 and back['width']>=24,back)
    record('Read Write link meets 24px pointer target',source_box['height']>=24 and source_box['width']>=24,source_box)

    route(page,'#/locker/sdfxs')
    page.evaluate("""() => { const original=window.ethereum.request.bind(window.ethereum); let reject=true; window.ethereum.request=async(args)=>{ if(args?.method==='wallet_switchEthereumChain' && reject){ reject=false; window.__walletCalls.push({method:'wallet_switchEthereumChain',params:args.params||[]}); const e=new Error('User rejected'); e.code=4001; throw e; } return original(args); }; }""")
    page.locator('#connectWallet').click(); page.locator('[data-wallet-key]').first.click()
    page.wait_for_selector('[data-action="switch-chain"]', timeout=10000)
    calls=page.evaluate("window.__walletCalls.filter(x=>x.method==='wallet_switchEthereumChain').length")
    record('wrong-chain connection automatically prompts wallet switch',calls>=1,calls)
    page.locator('[data-action="switch-chain"]').click(); page.wait_for_timeout(300)
    record('manual network recovery switches to Fraxtal',page.locator('#networkIndicator').inner_text().strip()=='Fraxtal',page.locator('#networkIndicator').inner_text())

    route(page,'#/')
    page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,value:false}); window.dispatchEvent(new Event('offline'))")
    record('offline event shows Connection Offline notice',page.locator('#offlineIndicator').is_visible() and page.locator('#offlineIndicator').inner_text()=='Connection Offline')
    page.evaluate("Object.defineProperty(navigator,'onLine',{configurable:true,value:true}); window.dispatchEvent(new Event('online'))")
    record('online event hides offline notice',page.locator('#offlineIndicator').is_hidden())

    browser.close()

summary={'version':3,'suite':'core','passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'results':RESULTS}
(OUT/'browser-core-results-v3.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({'suite':'core','passed':summary['passed'],'failed':summary['failed']}),flush=True)
raise SystemExit(1 if summary['failed'] else 0)
