from __future__ import annotations

import base64
import json
import mimetypes
import re
import secrets
from pathlib import Path
from typing import Any
from playwright.sync_api import sync_playwright, Page

ROOT = Path(__file__).resolve().parents[2]
OUT = Path('/mnt/data/curveyield-boosthub-qa-evidence-v11')
OUT.mkdir(parents=True, exist_ok=True)
CHROMIUM = '/usr/bin/chromium'
ACCOUNT = '0x1234567890abcdef1234567890abcdef12345678'


def data_uri(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
    encoded = base64.b64encode(path.read_bytes()).decode('ascii')
    return f'data:{mime};base64,{encoded}'


ASSET_REPLACEMENTS: dict[str, str] = {}
for p in (ROOT / 'assets').rglob('*'):
    if p.is_file():
        rel = './' + p.relative_to(ROOT).as_posix()
        ASSET_REPLACEMENTS[rel] = data_uri(p)

IMPORT_RE = re.compile(r'import\s+(?P<what>[\s\S]*?)\s+from\s+[\"\'](?P<path>\.\.?/[^\"\']+)[\"\']\s*;', re.MULTILINE)
module_cache: dict[Path, str] = {}
module_nonce = "initial"


def module_data_url(path: Path) -> str:
    path = path.resolve()
    if path in module_cache:
        return module_cache[path]
    source = path.read_text(encoding='utf-8')
    if path.name == 'app.js':
        source = source.replace('}).finally(async () => {\n  await attemptAutoReconnect();\n  await refreshAll({ force: true });\n});', '}).finally(async () => {\n  await attemptAutoReconnect();\n  if (!window.__CURVEYIELD_HARNESS_SKIP_INITIAL_REFRESH__) await refreshAll({ force: true });\n});')
    for rel, uri in ASSET_REPLACEMENTS.items():
        source = source.replace(rel, uri)

    def repl(match: re.Match[str]) -> str:
        child = (path.parent / match.group('path')).resolve()
        return f'import {match.group("what")} from "{module_data_url(child)}";'

    transformed = f'// harness-load:{module_nonce}\n' + IMPORT_RE.sub(repl, source)
    encoded = base64.b64encode(transformed.encode('utf-8')).decode('ascii')
    url = f'data:text/javascript;base64,{encoded}'
    module_cache[path] = url
    return url


def snapshot() -> dict[str, Any]:
    now = 1785295200000  # deterministic July 2026 timestamp
    token_data = {
        'sdcrv': ('sdCRV', '0xD1b5651E55D4CeeD36251c61c50C889B36F6abB5', 1416, 3205, 2.48, 92104.77, 1.0721),
        'sdfxn': ('sdFXN', '0xe19d1c837B8A1C83A56cD9165b2c0256D39653aD', 2574, 3460, 1.22, 28444.11, 1.0934),
        'sdfxs': ('sdFXS', '0x1AEe2382e05Dc68BDfC472F1E46d570feCca5814', 901, 1899, 1.93, 18432.22, 1.0132),
    }
    rewards = {
        'sdcrv': [('sdCRV', token_data['sdcrv'][1], 135), ('crvUSD', '0xf939E0A03FB07F59A73314E73794Be0E57ac1b4E', 355), ('CRV', '0xD533a949740bb3306d119CC777fa900bA034cd52', 135)],
        'sdfxn': [('sdFXN', token_data['sdfxn'][1], 0), ('wstETH', '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', 1440)],
        'sdfxs': [('sdFXS', token_data['sdfxs'][1], 0), ('WFRAX', '0xFc00000000000000000000000000000000000002', 625)],
    }
    lockers: dict[str, Any] = {}
    for idx, (locker_id, values) in enumerate(token_data.items()):
        symbol, address, default_apr, vault_apy, boost, boosting, pps = values
        locker_rewards = [
            {
                'symbol': sym,
                'address': addr.lower(),
                'decimals': 18,
                'aprBps': apr,
                'priceUsd': 1.0 if sym in ('crvUSD', 'WFRAX') else 0.72 + idx * 0.18,
                'icon': ASSET_REPLACEMENTS.get({
                    'sdFXS': './assets/tokens/stakedao/fxs.svg',
                    'sdCRV': './assets/tokens/stakedao/crv.svg',
                    'sdFXN': './assets/tokens/stakedao/fxn.svg',
                    'CRV': './assets/tokens/crv.png',
                    'crvUSD': './assets/tokens/crvusd-clean.png',
                    'wstETH': './assets/tokens/wsteth.svg',
                }.get(sym, ''), None),
            }
            for sym, addr, apr in rewards[locker_id]
        ]
        lockers[locker_id] = {
            'status': 'live',
            'updatedAt': now,
            'fieldErrors': {},
            'defaultAprBps': default_apr,
            'boostHubAprBps': default_apr + 220,
            'vaultApyBps': vault_apy,
            'boostMultiplier': boost,
            'boostModel': 'xchain-uniform' if locker_id == 'sdfxs' else None,
            'yieldBoostingTokens': boosting,
            'yieldBoostingTokenSymbol': symbol,
            'pps': pps,
            'vaultBalance': 400000 + idx * 100000,
            'stakingSupply': 750000 + idx * 120000,
            'assetPriceUsd': 0.9 + idx * 0.15,
            'rewards': locker_rewards,
            'claimRewards': locker_rewards,
            'topology': {
                'boostHubAddress': '0xFbEF8941Da53EA724385B44E91ae9672061D0263',
                'gaugeAddress': {
                    'sdcrv':'0x7f50786A0b15723D741727882ee99a0BF34e3466',
                    'sdfxn':'0xbcfE5c47129253C6B8a9A00565B3358b488D42E0',
                    'sdfxs':'0x12992595328E52267c95e45B1a97014D6Ddf8683',
                }[locker_id],
                'lpAddress': address,
                'strategyAddress': {
                    'sdcrv':'0x93DFEfeFd5D3736381086eFa5A8810F278138ADf',
                    'sdfxn':'0xc202f5137DE30b8170874e1DE55d1DbB2FA4CD45',
                    'sdfxs':'0xF64bC212C4dD190d10764B8B447C62368908c2AE',
                }[locker_id],
            },
        }
            lockers[locker_id]['curveApySource'] = {'selectedApyPcent': 11.90}
    return {
        'version': 16,
        'savedAt': now,
        'aggregate': {'status': 'live', 'updatedAt': now, 'fieldErrors': {}, 'vlsdtDelegated': 2384109.44},
        'lockers': lockers,
    }


def error_log(count: int = 28) -> list[dict[str, Any]]:
    contracts = {
        'sdcrv': '0xA6730b33203f005cab6c80a2fF1d8B73E1947F2C',
        'sdfxn': '0x7d53B437f950d6F515C8871aC985F1e875d6B52E',
        'sdfxs': '0xa4BfFa7D08dC3c5a46bFC668C6dDa290BB3Cf183',
    }
    entries = []
    for index in range(count):
        timestamp = 1785295000000 - index * 1000
        entry = {
            'id': f'seed-error-{index + 1}',
            'timestamp': timestamp,
            'action': ('read-very-long-topology-and-pending-reward-diagnostic-action-name-that-must-wrap-without-clipping' if index == 0 else f'read-fixture-{index + 1}'),
            'message': ('Representative RPC fallback event with an intentionally long message that verifies narrow-screen wrapping and bounded diagnostic scrolling.' if index == 0 else 'Representative RPC fallback event for diagnostics testing.'),
            'scope': 'wallet' if index % 7 == 0 else 'data',
            'status': 'problem',
            'lockerId': locker,
            'chain': 'fraxtal' if locker == 'sdfxs' else 'ethereum',
            'contractAddress': contracts[locker],
            'transactionHash': '0x' + f'{index + 1:064x}',
            'code': 'RPC_FALLBACK',
            'reason': 'Primary endpoint unavailable; cached data retained.',
            'details': 'Authorization: Bearer fixture-secret. This deterministic fixture verifies redaction and the developer error-log layout.',
            'count': 4 if index == 0 else 1,
            'firstTimestamp': timestamp - 3000 if index == 0 else timestamp,
            'lastTimestamp': timestamp,
            'occurrences': [timestamp, timestamp - 1000, timestamp - 2000, timestamp - 3000] if index == 0 else [timestamp],
        }
        entries.append(entry)
    return entries


def wallet_fixture_js(auto_accounts: bool = False) -> str:
    account = json.dumps(ACCOUNT)
    return f"""
window.__walletCalls = [];
window.__mockChainId = '0x1';
window.__returnMaxCalls = false;
window.__connectedAccounts = {f'[{account}]' if auto_accounts else '[]'};
const __provider = {{
  async request(args) {{
    const method = args?.method || '';
    window.__walletCalls.push({{ method, params: args?.params || [] }});
    if (method === 'eth_accounts') return window.__connectedAccounts;
    if (method === 'eth_requestAccounts') {{ window.__connectedAccounts = [{account}]; return window.__connectedAccounts; }}
    if (method === 'eth_chainId') return window.__mockChainId;
    if (method === 'net_version') return String(parseInt(window.__mockChainId, 16));
    if (method === 'wallet_switchEthereumChain') {{
      window.__mockChainId = args.params?.[0]?.chainId || window.__mockChainId;
      return null;
    }}
    if (method === 'wallet_addEthereumChain') return null;
    if (method === 'eth_blockNumber') return '0x123456';
    if (method === 'eth_getBalance' || method === 'eth_getTransactionCount') return '0x0';
    if (method === 'eth_call') return '0x' + (window.__returnMaxCalls ? 'f' : '0').repeat(64);
    if (method === 'eth_estimateGas') return '0x5208';
    if (method === 'eth_sendTransaction') return '0x' + 'a'.repeat(64);
    if (method === 'eth_getTransactionReceipt') return {{ transactionHash: '0x' + 'a'.repeat(64), blockNumber: '0x123457', blockHash: '0x' + 'b'.repeat(64), status: '0x1', cumulativeGasUsed: '0x5208', gasUsed: '0x5208', logs: [], logsBloom: '0x' + '0'.repeat(512), transactionIndex: '0x0', effectiveGasPrice: '0x1', type: '0x2' }};
    if (method === 'eth_getBlockByNumber') return {{ number: '0x123456', hash: '0x' + 'b'.repeat(64), parentHash: '0x' + 'c'.repeat(64), timestamp: '0x66a70000', nonce: '0x0000000000000000', difficulty: '0x0', gasLimit: '0x1c9c380', gasUsed: '0x0', miner: '0x' + '0'.repeat(40), extraData: '0x', baseFeePerGas: '0x1', transactions: [] }};
    return '0x0';
  }},
}};
window.ethereum = __provider;
window.__announceMockWallet = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {{ detail: {{ info: {{ uuid: 'mock-rabby', name: 'Rabby', icon: '', rdns: 'io.rabby' }}, provider: __provider }} }}));
window.__emitWalletEvent = () => undefined;
"""


def prelude_js(with_wallet: bool = False, auto_accounts: bool = False, diagnostic_count: int = 28) -> str:
    seed = json.dumps(json.dumps(snapshot(), separators=(',', ':')))
    errors = json.dumps(json.dumps(error_log(diagnostic_count), separators=(',', ':')))
    account = json.dumps(ACCOUNT)
    wallet = wallet_fixture_js(auto_accounts) if with_wallet else "window.__walletCalls = [];"
    return f"""
(() => {{
  window.__CURVEYIELD_HARNESS_SKIP_INITIAL_REFRESH__ = true;
  const map = new Map();
  Object.defineProperty(window, 'localStorage', {{ configurable: true, value: {{
    getItem(k) {{ return map.has(k) ? map.get(k) : null; }},
    setItem(k,v) {{ map.set(k, String(v)); }},
    removeItem(k) {{ map.delete(k); }},
    clear() {{ map.clear(); }},
    key(i) {{ return [...map.keys()][i] || null; }},
    get length() {{ return map.size; }}
  }} }});
  localStorage.setItem('curveyield.boosthub.live.v16', {seed});
  localStorage.setItem('curveyield.boosthub.errors.v1', {errors});
  Object.defineProperty(window, 'indexedDB', {{ configurable: true, value: undefined }});
  window.__returnMaxRpcCalls = false;
  window.__fetchCalls = [];
  window.BroadcastChannel = class {{ constructor(){{}} postMessage(){{}} close(){{}} }};
  Object.defineProperty(navigator, 'clipboard', {{ configurable: true, value: {{ writeText: async (value) => {{ window.__copiedText = value; }} }} }});
  const nativeSetInterval = window.setInterval.bind(window);
  window.setInterval = (fn, ms, ...args) => ms >= 300000 ? 1 : nativeSetInterval(fn, ms, ...args);
  const nativeWindowAddEventListener = window.addEventListener.bind(window);
  window.addEventListener = (type, listener, options) => type === 'focus' ? undefined : nativeWindowAddEventListener(type, listener, options);
  const nativeDocumentAddEventListener = document.addEventListener.bind(document);
  document.addEventListener = (type, listener, options) => type === 'visibilitychange' ? undefined : nativeDocumentAddEventListener(type, listener, options);
  window.fetch = async (input, init = {{}}) => {{
    const url = String(input?.url || input || '');
    const requestMethod = String(init.method || input?.method || 'GET').toUpperCase();
    let requestBody = init.body || '';
    if (!requestBody && input?.clone) {{ try {{ requestBody = await input.clone().text(); }} catch {{}} }}
    if (requestBody && typeof requestBody !== 'string') {{
      try {{
        if (requestBody instanceof ArrayBuffer) requestBody = new TextDecoder().decode(new Uint8Array(requestBody));
        else if (ArrayBuffer.isView(requestBody)) requestBody = new TextDecoder().decode(new Uint8Array(requestBody.buffer, requestBody.byteOffset, requestBody.byteLength));
        else if (Array.isArray(requestBody)) requestBody = new TextDecoder().decode(new Uint8Array(requestBody));
        else requestBody = String(requestBody);
      }} catch {{ requestBody = String(requestBody); }}
    }}
    if (window.__fetchCalls.length < 100) window.__fetchCalls.push({{url, requestMethod, requestBody: String(requestBody)}});
    if (requestMethod === 'POST') {{
      let payload = {{}};
      try {{ payload = JSON.parse(requestBody || '{{}}'); }} catch {{}}
      const one = (item) => {{
        const method = item?.method || '';
        let result = '0x' + ((method === 'eth_call' && window.__returnMaxRpcCalls) ? 'f' : '0').repeat(64);
        if (method === 'eth_chainId') result = url.includes('frax') ? '0xfc' : url.includes('base') ? '0x2105' : '0x1';
        else if (method === 'eth_blockNumber') result = '0x123456';
        else if (method === 'eth_getLogs') result = [];
        else if (method === 'eth_getBlockByNumber') result = {{ number:'0x123456', hash:'0x'+'b'.repeat(64), parentHash:'0x'+'c'.repeat(64), timestamp:'0x66a70000', nonce:'0x0000000000000000', difficulty:'0x0', gasLimit:'0x1c9c380', gasUsed:'0x0', miner:'0x'+'0'.repeat(40), extraData:'0x', baseFeePerGas:'0x1', transactions:[] }};
        return {{ jsonrpc:'2.0', id:item?.id ?? 1, result }};
      }};
      const body = JSON.stringify(Array.isArray(payload) ? payload.map(one) : one(payload));
      return new Response(body, {{ status: 200, headers: {{ 'content-type':'application/json' }} }});
    }}
    return new Response(JSON.stringify({{ error: 'offline fixture' }}), {{ status: 503, headers: {{ 'content-type':'application/json' }} }});
  }};
  {wallet}
}})();
"""


def base_html() -> str:
    html = (ROOT / 'index.html').read_text(encoding='utf-8')
    html = re.sub(r'<link rel="stylesheet"[^>]*>', '', html)
    html = re.sub(r'<script src="\.\/vendor\/ethers\.umd\.min\.js"></script>', '', html)
    html = re.sub(r'<script type="module" src="\.\/src-v11\/app\.js"></script>', '', html)
    for rel, uri in ASSET_REPLACEMENTS.items():
        html = html.replace(rel, uri)
    css = (ROOT / 'styles-v11.css').read_text(encoding='utf-8')
    html = html.replace('</head>', f'<style>{css}</style></head>')
    return html


def load_app(page: Page, route: str = '#/', with_wallet: bool = False, auto_accounts: bool = False, extra_prelude_js: str = '', diagnostic_count: int = 28) -> None:
    global module_nonce
    module_nonce = secrets.token_hex(8)
    module_cache.clear()
    page.set_content(base_html(), wait_until='domcontentloaded')
    page.evaluate(prelude_js(with_wallet=False, auto_accounts=False, diagnostic_count=diagnostic_count))
    if extra_prelude_js:
        page.evaluate(extra_prelude_js)
    page.evaluate('(hash) => { window.location.hash = hash; }', route)
    page.add_script_tag(content=(ROOT / 'vendor/ethers.umd.min.js').read_text(encoding='utf-8'))
    root_url = module_data_url(ROOT / 'src-v11/app.js')
    page.evaluate("url => { const s=document.createElement('script'); s.type='module'; s.src=url; document.body.appendChild(s); }", root_url)
    page.wait_for_selector('.overview, .locker-detail, .admin-page', timeout=30000)
    if with_wallet:
        page.evaluate(wallet_fixture_js(auto_accounts))
        page.evaluate('window.__announceMockWallet?.()')
    page.wait_for_timeout(1200)



if __name__ == '__main__':
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=CHROMIUM, args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1024})
        logs: list[str] = []
        page.on('console', lambda msg: logs.append(f'{msg.type}: {msg.text}'))
        load_app(page)
        print(page.title())
        print(page.locator('body').inner_text()[:2500])
        page.screenshot(path=str(OUT / 'overview-harness-1440x1024-v1.png'), full_page=True)
        (OUT / 'harness-console-v1.txt').write_text('\n'.join(logs), encoding='utf-8')
        print('console lines', len(logs))
        browser.close()
