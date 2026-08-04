from pathlib import Path
import hashlib, json, os

root = Path(os.environ['RECOVERY_ROOT'])
request = json.loads((root / 'REQUEST-v2.json').read_text())
manifest = json.loads((root / 'CHUNK-MANIFEST-v2.json').read_text())
expected_request = {
    'schemaVersion': 'curveyield-source-recovery-request-v2',
    'branch': os.environ['BRANCH'],
    'archiveStem': os.environ['STEM'],
    'zipName': os.environ['ZIP_NAME'],
    'zipSizeBytes': int(os.environ['ZIP_SIZE']),
    'zipSha256': os.environ['ZIP_SHA256'],
    'compressedSizeBytes': int(os.environ['XZ_SIZE']),
    'compressedSha256': os.environ['XZ_SHA256'],
    'chunkManifest': '.source-recovery/v2/CHUNK-MANIFEST-v2.json',
}
if request != expected_request:
    raise SystemExit('recovery request mismatch')
if manifest.get('schemaVersion') != 'curveyield-source-recovery-chunks-v2':
    raise SystemExit('chunk manifest schema mismatch')
if manifest.get('encoding') != 'base64' or manifest.get('transportCompression') != 'xz':
    raise SystemExit('transport encoding mismatch')
if manifest.get('chunkSize') != 8192:
    raise SystemExit('chunk size mismatch')
if manifest.get('compressedSizeBytes') != int(os.environ['XZ_SIZE']):
    raise SystemExit('compressed size declaration mismatch')
if manifest.get('compressedSha256') != os.environ['XZ_SHA256']:
    raise SystemExit('compressed hash declaration mismatch')
chunks = manifest.get('chunks')
if not isinstance(chunks, list) or len(chunks) != manifest.get('chunkCount'):
    raise SystemExit('chunk count mismatch')
encoded_length = 0
for position, item in enumerate(chunks):
    if not isinstance(item, list) or len(item) != 2:
        raise SystemExit(f'chunk metadata mismatch: {position}')
    expected_length, expected_sha256 = item
    expected_file = f'part-{position:03d}.b64'
    path = root / 'chunks' / expected_file
    if not path.is_file():
        raise SystemExit(f'missing chunk: {expected_file}')
    data = path.read_bytes()
    if len(data) != expected_length:
        raise SystemExit(f'chunk length mismatch: {expected_file}')
    if hashlib.sha256(data).hexdigest() != expected_sha256:
        raise SystemExit(f'chunk hash mismatch: {expected_file}')
    encoded_length += len(data)
if encoded_length != manifest.get('encodedLength'):
    raise SystemExit('encoded length mismatch')
