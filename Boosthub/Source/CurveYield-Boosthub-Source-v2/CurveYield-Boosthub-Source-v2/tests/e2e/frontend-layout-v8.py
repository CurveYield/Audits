from __future__ import annotations
import json
from playwright.sync_api import sync_playwright
from render_harness_v10 import load_app, OUT, CHROMIUM

results=[]
def check(name, passed, details=''):
    results.append({'name': name, 'passed': bool(passed), 'details': details})
    print(('PASS' if passed else 'FAIL'), name, details, flush=True)

def rects(locator):
    return locator.evaluate_all("els => els.map(el => { const r=el.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}; })")

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1440,'height':1024})
    load_app(page, route='#/')
    headers=page.locator('.home-reward-column h3').all_inner_texts()
    check('desktop has separate staking and vault reward headers', headers==['Staking Rewards','Vault Rewards']*4, headers)
    check('combined reward header is absent', all('Staking & Vault' not in h for h in headers), headers)
    check('four staking reward cells render', page.locator('.staking-reward-column').count()==4)
    check('four vault reward cells render', page.locator('.vault-reward-column').count()==4)
    for idx in range(4):
        row=page.locator('.locker-row').nth(idx)
        boxes=rects(row.locator('.staking-reward-column, .vault-reward-column'))
        check(f'locker {idx+1} reward columns are independent and side by side', len(boxes)==2 and abs(boxes[0]['y']-boxes[1]['y'])<2 and boxes[1]['x']>boxes[0]['x'], boxes)
    check('desktop homepage has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    summary_icon_fit = page.locator('.white-summary-card').first.evaluate("""el => {
        const card = el.getBoundingClientRect();
        const icon = el.querySelector('.summary-icon')?.getBoundingClientRect();
        return icon ? {cardRight: card.right, iconRight: icon.right, fits: icon.right <= card.right + 0.5} : {fits: false};
    }""")
    check('desktop aggregate icons remain fully inside their cards', summary_icon_fit.get('fits') is True, summary_icon_fit)
    page.screenshot(path=str(OUT/'overview-1440x1024-v11.png'), full_page=True)

    page.set_viewport_size({'width':390,'height':844})
    page.evaluate("location.hash='#/'")
    page.wait_for_timeout(180)
    first=page.locator('.locker-row').first
    reward_boxes=rects(first.locator('.staking-reward-column, .vault-reward-column'))
    check('mobile keeps staking and vault as two columns', len(reward_boxes)==2 and abs(reward_boxes[0]['y']-reward_boxes[1]['y'])<2 and reward_boxes[1]['x']>reward_boxes[0]['x'], reward_boxes)
    staking_boxes=rects(first.locator('.staking-reward-column .reward-pill'))
    check('mobile staking reward tokens stack vertically', len(staking_boxes)>=2 and max(round(b['x']) for b in staking_boxes)-min(round(b['x']) for b in staking_boxes)<=2 and all(staking_boxes[i]['y'] < staking_boxes[i+1]['y'] for i in range(len(staking_boxes)-1)), staking_boxes)
    check('390px homepage has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    page.screenshot(path=str(OUT/'overview-390x844-v11.png'), full_page=True)

    page.set_viewport_size({'width':320,'height':568})
    page.evaluate("location.hash='#/'")
    page.wait_for_timeout(180)
    check('320px homepage has no horizontal overflow', page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'))
    page.screenshot(path=str(OUT/'overview-320x568-v11.png'), full_page=True)
    browser.close()

summary={'suite':'frontend-layout-v11','passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'results':results}
(OUT/'frontend-layout-results-v11.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps({'passed':summary['passed'],'failed':summary['failed']}))
raise SystemExit(1 if summary['failed'] else 0)
