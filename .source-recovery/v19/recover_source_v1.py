from pathlib import Path, PurePosixPath
import hashlib, os, shutil, stat, zipfile

STEM = os.environ['STEM']
ZIP_NAME = os.environ['ZIP_NAME']
ZIP_SIZE = int(os.environ['ZIP_SIZE'])
ZIP_SHA256 = os.environ['ZIP_SHA256'].lower()
EXPECTED_MEMBERS = int(os.environ['FILE_COUNT'])
ROOT = Path.cwd()
RECOVERY = ROOT / '.source-recovery' / 'v19'
CHUNKS = RECOVERY / 'chunks'
OUT_Z_DIR = ROOT / STEM / f'(Z) {STEM}'
OUT_U_DIR = ROOT / STEM / f'(U) {STEM}'
TMP_ZIP = Path('/tmp/vlsdt-v19-source.zip')

parts = sorted(CHUNKS.glob('part-*.b64'))
if not parts:
    raise SystemExit('no transport chunks')
with TMP_ZIP.open('wb') as out:
    import base64
    carry = ''
    for part in parts:
        s = carry + part.read_text(encoding='ascii')
        usable = len(s) - (len(s) % 4)
        if usable:
            out.write(base64.b64decode(s[:usable], validate=True))
        carry = s[usable:]
    if carry:
        out.write(base64.b64decode(carry, validate=True))

raw = TMP_ZIP.read_bytes()
if len(raw) != ZIP_SIZE:
    raise SystemExit(f'ZIP size mismatch: {len(raw)} != {ZIP_SIZE}')
sha = hashlib.sha256(raw).hexdigest()
if sha != ZIP_SHA256:
    raise SystemExit(f'ZIP SHA-256 mismatch: {sha} != {ZIP_SHA256}')
expected_git = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
print(f'ZIP_SHA256={sha}')
print(f'ZIP_GIT_BLOB_SHA={expected_git}')

seen = set()
regular = []
with zipfile.ZipFile(TMP_ZIP) as zf:
    for info in zf.infolist():
        name = info.filename
        if '\\' in name or name.startswith('/'):
            raise SystemExit(f'unsafe ZIP member: {name!r}')
        p = PurePosixPath(name)
        if any(part in ('', '.', '..') for part in p.parts if part != ''):
            raise SystemExit(f'unsafe ZIP member: {name!r}')
        norm = str(p)
        if norm in seen:
            raise SystemExit(f'duplicate ZIP member: {norm}')
        seen.add(norm)
        mode = (info.external_attr >> 16) & 0o170000
        if mode == stat.S_IFLNK:
            raise SystemExit(f'symlink ZIP member: {norm}')
        if not info.is_dir():
            regular.append((info, p))
    if len(regular) != EXPECTED_MEMBERS:
        raise SystemExit(f'regular-member count mismatch: {len(regular)} != {EXPECTED_MEMBERS}')

if (ROOT / STEM).exists():
    shutil.rmtree(ROOT / STEM)
OUT_Z_DIR.mkdir(parents=True, exist_ok=False)
OUT_U_DIR.mkdir(parents=True, exist_ok=False)
(OUT_Z_DIR / ZIP_NAME).write_bytes(raw)

with zipfile.ZipFile(TMP_ZIP) as zf:
    for info, p in regular:
        dest = OUT_U_DIR.joinpath(*p.parts)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(zf.read(info))

# Verify the package's v19 manifest when present. The manifest intentionally
# does not self-list, so validate every line it does list without inventing an entry.
manifests = list(OUT_U_DIR.rglob('Source-Manifest-v19.sha256'))
if len(manifests) != 1:
    raise SystemExit(f'expected one Source-Manifest-v19.sha256, found {len(manifests)}')
manifest = manifests[0]
manifest_root = manifest.parent
listed = 0
for line in manifest.read_text(encoding='utf-8').splitlines():
    line = line.strip()
    if not line:
        continue
    digest, rel = line.split(None, 1)
    rel = rel.lstrip('* ')
    target = manifest_root / PurePosixPath(rel)
    if not target.is_file():
        raise SystemExit(f'manifest target missing: {rel}')
    got = hashlib.sha256(target.read_bytes()).hexdigest()
    if got.lower() != digest.lower():
        raise SystemExit(f'manifest mismatch: {rel}: {got} != {digest}')
    listed += 1
print(f'REGULAR_MEMBERS={len(regular)}')
print(f'MANIFEST_LISTED={listed}')
