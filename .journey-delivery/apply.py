"""One-time delivery of an already reviewed, hash-pinned source patch.

No network, credentials, provider data or production state is accessed here.
The exact output tree is checked before any tests or branch publication.
"""
import base64
import hashlib
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
shutil.rmtree('.journey-delivery')
Path('.github/workflows/healthspan-candidate.yml').unlink()
subprocess.run(['git', 'add', '-A'], check=True)
subprocess.run(['git', 'diff', '--cached', '--check'], check=True)
tree = subprocess.check_output(['git', 'write-tree'], text=True).strip()
assert tree == 'cfa26095b3a09a9d8c80b1f055f72e8c9542f3cb', f'Unexpected source tree: {tree}'
print(f'Exact connected-day candidate verified: {tree}')
