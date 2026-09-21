"""One-time hash-pinned source delivery. No network or production data access."""
import base64
import hashlib
import json
import lzma
from pathlib import Path
import shutil
import subprocess

parts = [Path(f'.journey-delivery/part{i}.b64') for i in range(1, 6)]
compressed = base64.b64decode(''.join(p.read_text().strip() for p in parts), validate=True)
assert hashlib.sha256(compressed).hexdigest() == '264dd7a29df4a339dcb82fbec3ffe14f2c1bf0b032900e9811d8c6bc7b63dfed', 'Delivery checksum mismatch'
patch = lzma.decompress(compressed)
assert hashlib.sha256(patch).hexdigest() == '6da96ee02dbf07ae125c8fdfd46c2a15cd39d4a96bf8ac9c2cb712b2ffa1dd23', 'Patch checksum mismatch'
subprocess.run(['git', 'apply', '--check', '--unidiff-zero', '-'], input=patch, check=True)
subprocess.run(['git', 'apply', '--unidiff-zero', '-'], input=patch, check=True)
# Two compile-time corrections discovered by the dependency-resolved app check.
p = Path('utils/dayJourney.ts')
s = p.read_text()
assert 'const phase = now.getHours()' in s
p.write_text(s.replace('const phase = now.getHours()', "const phase: DailyBrief['phase'] = now.getHours()"))
p = Path('tsconfig.json')
config = json.loads(p.read_text())
config['compilerOptions']['allowImportingTsExtensions'] = True
config['compilerOptions']['noEmit'] = True
p.write_text(json.dumps(config, indent=2) + '\n')
shutil.rmtree('.journey-delivery')
Path('.github/workflows/healthspan-candidate.yml').unlink()
subprocess.run(['git', 'add', '-A'], check=True)
subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
tree = subprocess.check_output(['git', 'write-tree'], text=True).strip()
assert tree == '8691c9d60dd6845d1b8a5a0893abc495d6f2d3db', f'Unexpected source tree: {tree}'
print(f'Exact connected-day candidate verified: {tree}')
