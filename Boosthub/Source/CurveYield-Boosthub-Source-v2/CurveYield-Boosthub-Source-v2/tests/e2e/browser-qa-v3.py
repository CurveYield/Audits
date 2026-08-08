from __future__ import annotations

import json
import subprocess
import os
import signal
import sys
from pathlib import Path
from render_harness_v10 import OUT

HERE=Path(__file__).resolve().parent
suites=["browser-qa-core-v3.py","browser-qa-diagnostics-v3.py","browser-qa-admin-desktop-v3.py","browser-qa-walletconnect-v3.py"]
result_files=[OUT/"browser-core-results-v3.json",OUT/"browser-diagnostics-results-v3.json",OUT/"browser-admin-desktop-results-v3.json",OUT/"browser-walletconnect-results-v3.json"]
outputs=[]
for suite in suites:
    print(f"START {suite}", flush=True)
    process=subprocess.Popen([sys.executable,str(HERE/suite)],cwd=str(HERE),start_new_session=True)
    try:
        returncode=process.wait(timeout=600)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        process.wait()
        raise
    finally:
        try: os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError: pass
    print(f"RETURN {suite} {returncode}", flush=True)
    outputs.append({"suite":suite,"returncode":returncode})
    if returncode:
        raise SystemExit(returncode)

parts=[json.loads(path.read_text(encoding="utf-8")) for path in result_files]
results=[entry for part in parts for entry in part["results"]]
console=[entry for part in parts for entry in part.get("console",[])]
summary={"version":3,"passed":sum(r["passed"] for r in results),"failed":sum(not r["passed"] for r in results),"results":results,"console":console,"suites":outputs,"blockedChecks":[{"name":"live service-worker offline reload","reason":"Chromium navigation is blocked by the execution environment administrator policy; service-worker install, activation, scoped cache, navigation fallback, and RPC exclusion are covered by local unit tests."}]}
(OUT/"browser-qa-results-v3.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
(OUT/"browser-console-v3.txt").write_text("\n".join(console),encoding="utf-8")
print(json.dumps({"passed":summary["passed"],"failed":summary["failed"]},indent=2))
if summary["failed"]: raise SystemExit(1)
