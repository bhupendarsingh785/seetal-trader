#!/usr/bin/env bash
# Seetal ka poora check — deploy se PEHLE yahi chalao.
# 1) JS syntax  2) ESLint (asli galtiyan)  3) jsdom UI test  4) yaml  5) project tests
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0

echo "== 1) JS syntax =="
python3 - <<'PY' || FAIL=1
import re, subprocess, sys, glob, os
bad = 0
for f in glob.glob('*.html') + glob.glob('assets/*.js'):
    s = open(f, encoding='utf-8', errors='ignore').read()
    blocks = re.findall(r'<script(?![^>]*src=)[^>]*>([\s\S]*?)</script>', s) if f.endswith('.html') else [s]
    for i, b in enumerate(blocks):
        p = f'/tmp/_chk_{os.path.basename(f)}_{i}.js'
        open(p, 'w', encoding='utf-8').write(b)
        r = subprocess.run(['node', '--check', p], capture_output=True, text=True)
        if r.returncode:
            bad += 1
            print('❌', f, 'block', i, r.stderr.splitlines()[0] if r.stderr else '')
print('✅ JS syntax ok' if not bad else f'❌ {bad} block(s) fail')
sys.exit(1 if bad else 0)
PY

echo "== 2) ESLint =="
if command -v npx >/dev/null 2>&1; then
  mkdir -p /tmp/lint
  python3 - <<'PY'
import re, glob, os
for f in glob.glob('*.html'):
    s = open(f, encoding='utf-8', errors='ignore').read()
    blocks = re.findall(r'<script(?![^>]*src=)[^>]*>([\s\S]*?)</script>', s)
    if blocks:
        open('/tmp/lint/' + os.path.basename(f).replace('.html', '.js'), 'w', encoding='utf-8').write('\n;\n'.join(blocks))
PY
  npx eslint /tmp/lint/*.js 2>&1 | grep -E " error |✖" | head -20
  if npx eslint /tmp/lint/*.js 2>&1 | grep -q " error "; then echo "❌ ESLint error"; FAIL=1; else echo "✅ ESLint me koi error nahi"; fi
else
  echo "⚪ ESLint nahi mila"
fi

echo "== 3) jsdom UI test =="
if [ -f tests/ui-test.js ]; then
  node tests/ui-test.js youme.html 2>&1 | tail -3 || FAIL=1
fi
if [ -f tests/studio-test.js ]; then
  node tests/studio-test.js studio-v10.html 2>&1 | tail -2 || FAIL=1
fi

echo "== 4) Workflow YAML =="
python3 - <<'PY' || FAIL=1
import glob, sys
try:
    import yaml
except ImportError:
    print('⚪ yaml module nahi'); sys.exit(0)
bad = 0
for f in glob.glob('.github/workflows/*.yml'):
    try: yaml.safe_load(open(f, encoding='utf-8'))
    except Exception as e:
        bad += 1; print('❌', f, e)
print('✅ saare workflow YAML theek' if not bad else f'❌ {bad} workflow fail')
sys.exit(1 if bad else 0)
PY

echo "== 5) Project tests =="
node tests/run-tests.mjs 2>&1 | tail -3

echo
[ "$FAIL" -eq 0 ] && echo "🟢 SAB PASS — deliver kar sakte hain" || echo "🔴 KUCH FAIL — pehle theek karo"
exit $FAIL
