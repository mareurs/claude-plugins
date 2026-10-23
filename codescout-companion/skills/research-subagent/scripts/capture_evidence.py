#!/usr/bin/env python3
"""Copy a saved report as bytes and record its SHA-256; never render Markdown."""
import argparse
import hashlib
import json
from pathlib import Path


def capture(source: Path, audit_dir: Path, sequence: int) -> dict:
    data = source.read_bytes()
    audit_dir.mkdir(parents=True, exist_ok=True)
    destination = audit_dir / f'full-report-{sequence}.md'
    manifest_path = audit_dir / f'full-report-{sequence}.manifest.json'
    if destination.exists() or manifest_path.exists():
        raise FileExistsError(f'Snapshot already exists: {destination}')
    with destination.open('xb') as output:
        output.write(data)
    digest = hashlib.sha256(data).hexdigest()
    if hashlib.sha256(destination.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Snapshot verification failed')
    manifest = {'source': str(source.resolve()), 'destination': str(destination.resolve()),
                'sha256': digest, 'bytes': len(data)}
    with manifest_path.open('x', encoding='utf-8') as output:
        json.dump(manifest, output, indent=2)
        output.write('\n')
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('audit_dir', type=Path)
    parser.add_argument('--sequence', type=int, default=1)
    args = parser.parse_args()
    print(json.dumps(capture(args.source, args.audit_dir, args.sequence)))


if __name__ == '__main__':
    main()
