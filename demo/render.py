#!/usr/bin/env python3
"""Deterministic demo renderer.

The live-screen approach kept truncating: the browser stopped repainting after the longest scene in
every take, so the last two scenes never appeared. This renders the same content instead:

  1. run the four commands FOR REAL and capture their real output,
  2. render each scene state to a PNG with headless Chrome (terminal styling, no banner),
  3. concatenate the states to the narration timeline and mux the narration.

The result is the same session — real 402 challenge, real settlement, real ledger numbers, real rank
probe — just assembled deterministically instead of captured off a live canvas.
"""
import html, json, os, subprocess, sys, textwrap

D = '/home/bg/.hermes/cache/scratch/demo'
HOME = os.path.expanduser('~')
BOT, TOOLKIT = f'{HOME}/bot-economy', f'{HOME}/x402-seller-toolkit'
BASE = 'https://health-api.tail11a58f.ts.net'
TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
OURS = ('0x6Ab835A5e4707066c14a719dBf19080582b5ed84,0xb92A731C08bF78f5EC87E8b48C74aBf685e84029,'
        '0x0b6DEdB1441BA2e0e322FebA27335c960408ae27,0x70d20d594B5fa5b30C9D3A62AA3FDDFB7612C78c')
CHROME = subprocess.check_output(['bash', '-lc',
    "find /home/bg/.hermes/tools /home/bg/.hermes/desktop -maxdepth 5 -type f -name chrome 2>/dev/null | head -1"]).decode().strip()
FF = subprocess.check_output(['bash', '-lc', 'command -v ffmpeg']).decode().strip()

CHALLENGE = (f"curl -s -D - -o /dev/null '{BASE}/shield/screen?address={TOKEN}' | grep -i '^payment-required' "
             "| sed 's/^[^:]*: *//' | tr -d '\\r' | base64 -d | python3 -c \"import json,sys; d=json.load(sys.stdin); "
             "a=d['accepts'][0]; r=d.get('resource'); r=r.get('url') if isinstance(r,dict) else r; "
             "print('  resource  ' + str(r)); print('  network   ' + a['network']); print('  asset     ' + a['asset'] + '  (USDC)'); "
             "print('  amount    $' + str(int(a['amount'])/1e6)); print('  payTo     ' + a['payTo']); print('  scheme    ' + a['scheme'])\"")

STEPS = [
    ('1/4  the challenge — a real 402 from a live seller',
     'a buyer asks for a paid route with no payment attached',
     CHALLENGE, BOT, ['resource  ', 'network  ', 'asset   ', 'amount  ', 'payTo   ', 'scheme  ']),
    ('2/4  the settlement — real USDC on Base mainnet',
     'a capped buyer agent signs a gasless EIP-3009 authorization; the facilitator submits and pays gas',
     f"node buyer/buyer.js '{BASE}/shield/screen?address={TOKEN}' \"\" 0.02", BOT,
     ['[buyer] wallet', '"ok": true', '"status": 200', '"payer"', '"transaction"', '"network"', '"grade"', '"label"', '"reason"', 'spentUsdc']),
    ('3/4  the ledger — server-side truth, not the dashboard',
     'the same sale read back from SQLite: challenges vs settles, sweeps vs repeat vs self-pay',
     f'node tools/funnel-report.mjs --db {BOT}/data/ledger.db --ours {OURS}', TOOLKIT, None),
    ('4/4  discovery — why listings get traffic and no revenue',
     'the toolkit probes the words a buyer would actually type in the public index',
     f'node tools/rank-probe.mjs --host health-api.tail11a58f.ts.net --queries '
     f'"x402 test endpoint,token security,rug pull detection,token due diligence"', TOOLKIT, None),
]
CLOSING = ['', '✓ live on Base mainnet · 7 Bazaar listings · real settlements, verifiable on Basescan',
           '  honest number: 4 external payers, $0.004 — and now it is diagnosable, not mysterious',
           '', '  github.com/bGhullu/x402-seller-toolkit   MIT   zero dependencies']
TIMELINE = [13.83, 14.99, 19.56, 30.58, 19.15, 15.87]   # title, scenes 1-4, closing (seconds)


def run(cmd, cwd, keep):
    out = subprocess.run(['bash', '-lc', cmd], cwd=cwd, capture_output=True, text=True, timeout=90)
    lines = (out.stdout + out.stderr).split('\n')
    if keep is None:
        return [l for l in lines if l.strip()]
    kept = [l for l in lines if any(k in l for k in keep)]
    return kept or [l for l in lines if l.strip()][:12]


CSS = """*{box-sizing:border-box}html,body{margin:0;height:720px;background:#05070a;color:#c9d1d9;
font-family:'DejaVu Sans Mono',Menlo,Consolas,monospace;overflow:hidden}
#wrap{height:720px;display:flex;flex-direction:column;padding:12px 16px}
#bar{display:flex;align-items:center;gap:9px;padding-bottom:9px;border-bottom:1px solid #1f2630;flex:0 0 auto}
.dot{width:11px;height:11px;border-radius:50%}.d1{background:#ff5f57}.d2{background:#febc2e}.d3{background:#28c840}
#title{font-size:12.5px;color:#8b949e;margin-left:5px}
#hud{margin-left:auto;font-size:11.5px;color:#3fb950;border:1px solid #238636;border-radius:4px;padding:2px 8px}
#screen{flex:1 1 auto;display:flex;flex-direction:column;justify-content:flex-end;padding-top:10px;font-size:13px;line-height:1.42;overflow:hidden}
.step{margin:9px 0 4px 0;color:#58a6ff;font-weight:bold}.lab{color:#8b949e;margin-bottom:5px}
.cmd{color:#7ee787;word-break:break-all;margin-bottom:5px}
.out{white-space:pre-wrap;word-break:break-word}
.ok{color:#3fb950}.warn{color:#d29922}
#foot{padding-top:7px;border-top:1px solid #1f2630;font-size:11.5px;color:#6e7681;flex:0 0 auto}
.cursor{display:inline-block;width:8px;height:15px;background:#c9d1d9;vertical-align:-2px}
.tc{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}
.tc b{font-size:26px;color:#e6edf3;font-weight:600}.tc i{font-style:normal;color:#58a6ff;font-size:15px}
.tc u{text-decoration:none;color:#8b949e;font-size:13px}"""


def page(state, blocks):
    body = []
    if state == 0:
        body.append('<div class="tc"><b>x402-seller-toolkit</b><i>a real session against a live mainnet seller</i>'
                    '<u>402 challenge → settlement → ledger → discovery</u></div>')
    else:
        for title, label, cmd, lines in blocks:
            if title:  # the closing block has no header
                body.append(f'<div class="step">$ {html.escape(title)}</div>')
                body.append(f'<div class="lab"># {html.escape(label)}</div>')
                body.append(f'<div class="cmd">$ {html.escape(cmd[:168])}</div>')
            for l in lines:
                cls = 'out ok' if l.strip().startswith('✓') else ('out warn' if 'honest number' in l else 'out')
                body.append(f'<div class="{cls}">{html.escape(l) or "&nbsp;"}</div>')
        if state >= 5:
            body.append('<div class="out"><span class="cursor"></span></div>')
    return (f'<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div id="wrap">'
            f'<div id="bar"><div class="dot d1"></div><div class="dot d2"></div><div class="dot d3"></div>'
            f'<div id="title">x402 seller — live on Base mainnet — health-api.tail11a58f.ts.net</div>'
            f'<div id="hud">REC</div></div><div id="screen">{"".join(body)}</div>'
            f'<div id="foot">github.com/bGhullu/x402-seller-toolkit — MIT</div></div></body></html>')


def main():
    print('running the real commands (this spends one real $0.01 settlement)')
    blocks = []
    for i, (title, label, cmd, cwd, keep) in enumerate(STEPS, 1):
        lines = run(cmd, cwd, keep)
        print(f'  scene {i}: {len(lines)} output lines')
        blocks.append((title, label, cmd, lines))

    shots = []
    for state in range(6):
        use = blocks if state == 0 else blocks[:state]
        path = f'{D}/state{state}.html'
        open(path, 'w').write(page(state, use + ([('', '', '', CLOSING)] if state >= 5 else [])))
        png = f'{D}/state{state}.png'
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
                        '--window-size=1280,720', f'--screenshot={png}', f'file://{path}'],
                       check=True, capture_output=True, timeout=90)
        print(f'  state{state}.png  {os.path.getsize(png)//1024} KB')
        shots.append(png)

    with open(f'{D}/frames.txt', 'w') as fh:
        for png, dur in zip(shots, TIMELINE):
            fh.write(f"file '{png}'\nduration {dur:.3f}\n")
        fh.write(f"file '{shots[-1]}'\n")          # concat demuxer needs the last file repeated
    subprocess.run([FF, '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', f'{D}/frames.txt',
                    '-vsync', 'vfr', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
                    '-pix_fmt', 'yuv420p', f'{D}/visual.mp4'], check=True)
    # the closing narration is 15.87s: hold the last frame that long too
    subprocess.run([FF, '-y', '-loglevel', 'error', '-i', f'{D}/visual.mp4', '-i', f'{D}/narration_final.wav',
                    '-filter_complex', '[0:v]tpad=stop_mode=clone:stop_duration=20[v]', '-map', '[v]', '-map', '1:a',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
                    '-c:a', 'aac', '-b:a', '128k', '-shortest', f'{D}/x402-demo.mp4'], check=True)
    dur = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                                   '-of', 'csv=p=0', f'{D}/x402-demo.mp4']).decode().strip()
    print(f'  FINAL x402-demo.mp4 = {dur}s / {os.path.getsize(f"{D}/x402-demo.mp4")//1024} KB')


if __name__ == '__main__':
    main()
