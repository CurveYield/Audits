from pathlib import Path
import hashlib, json, os, shutil, stat, zipfile

stem = os.environ['STEM']
zip_name = os.environ['ZIP_NAME']
expected_files = int(os.environ['FILE_COUNT'])
expected_internal = int(os.environ['INTERNAL_MANIFEST_COUNT'])
base = Path(stem)
zdir = base / f'(Z) {stem}'
udir = base / f'(U) {stem}'
if base.exists():
    shutil.rmtree(base)
zdir.mkdir(parents=True)
udir.mkdir(parents=True)
archive = Path('/tmp/source.zip')
shutil.copyfile(archive, zdir / zip_name)
seen = set()
expanded = 0
with zipfile.ZipFile(archive) as zf:
    for info in zf.infolist():
        name = info.filename
        path = Path(name)
        mode = (info.external_attr >> 16) & 0xFFFF
        if name.startswith(('/', '\\')) or path.is_absolute() or '..' in path.parts:
            raise SystemExit(f'unsafe archive path: {name}')
        if name in seen:
            raise SystemExit(f'duplicate archive path: {name}')
        if stat.S_ISLNK(mode):
            raise SystemExit(f'symlink archive entry: {name}')
        seen.add(name)
        expanded += info.file_size
        if expanded > 100_000_000:
            raise SystemExit('archive expansion exceeds safety bound')
    zf.extractall(udir)
files = []
for path in sorted(udir.rglob('*')):
    if path.is_file():
        data = path.read_bytes()
        files.append({'path': path.relative_to(udir).as_posix(), 'sizeBytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
if len(files) != expected_files:
    raise SystemExit(f'extracted file count mismatch: {len(files)}')
roots = sorted({Path(item['path']).parts[0] for item in files})
if len(roots) != 1:
    raise SystemExit(f'unexpected extraction roots: {roots}')
source_root = roots[0]
internal = udir / source_root / 'Source-Manifest-v18.sha256'
if not internal.is_file():
    raise SystemExit('internal manifest missing')
checked = 0
for line in internal.read_text().splitlines():
    line = line.strip()
    if not line:
        continue
    expected, rel = line.split(None, 1)
    rel = rel.lstrip('*').removeprefix('./')
    target = internal.parent / rel
    if not target.is_file():
        raise SystemExit(f'internal manifest file missing: {rel}')
    if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'internal manifest hash mismatch: {rel}')
    checked += 1
if checked != expected_internal:
    raise SystemExit(f'internal manifest count mismatch: {checked}')
result = {
    'schemaVersion': 'curveyield-source-recovery-result-v1',
    'archiveStem': stem,
    'zipName': zip_name,
    'zipSizeBytes': int(os.environ['ZIP_SIZE']),
    'zipSha256': os.environ['ZIP_SHA256'],
    'transportCompression': 'xz',
    'compressedSizeBytes': int(os.environ['XZ_SIZE']),
    'compressedSha256': os.environ['XZ_SHA256'],
    'sourceRoot': source_root,
    'fileCount': len(files),
    'internalManifestEntryCount': checked,
    'sourceBytesModified': False,
    'compilationPerformed': False,
    'dependencyDownloadPerformed': False,
    'files': files,
}
(base / 'SOURCE-RECOVERY-RESULT-v1.json').write_text(json.dumps(result, indent=2) + '\n')
