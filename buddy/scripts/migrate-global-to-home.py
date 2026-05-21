"""One-time, idempotent migration of per-profile global buddy state into a
single profile-agnostic home (default ~/.buddy).

Config trees (skills/, memory/, plus identity.json): copy-if-absent,
skip-if-identical, newest-mtime-wins-if-divergent (loser archived under
<dest>/.migration-backup/<profile>/<relpath>). summons.log: union of all
profiles, sorted, deduped.

Source profiles are left in place; delete them by hand once verified.
Dry-run by default; pass --apply to write.
"""
from __future__ import annotations

import argparse
import filecmp
import shutil
import sys
from pathlib import Path

PROFILES = (".claude", ".claude-sdd", ".claude-kat")
# Per-file config trees migrated with newest-wins semantics.
CONFIG_TREES = ("skills", "memory")
# Single config files at the buddy/ root migrated with newest-wins semantics.
CONFIG_FILES = ("identity.json",)


def _iter_files(root: Path):
    for p in sorted(root.rglob("*")):
        if p.is_file():
            yield p


def run(*, home: Path, dest: Path, apply: bool) -> dict:
    home = Path(home)
    dest = Path(dest)
    sources = [home / name / "buddy" for name in PROFILES if (home / name / "buddy").is_dir()]
    stats = {"copied": 0, "skipped": 0, "conflicts": 0, "backups": 0, "sources": [str(s) for s in sources]}
    summons_lines: set[str] = set()

    for src in sources:
        profile = src.parent.name  # e.g. ".claude-sdd"

        # 1. summons.log → collect for union.
        slog = src / "summons.log"
        if slog.is_file():
            summons_lines.update(
                ln for ln in slog.read_text().splitlines() if ln.strip()
            )

        # 2. config trees + single config files → newest-wins per relative path.
        members: list[Path] = []
        for tree in CONFIG_TREES:
            tdir = src / tree
            if tdir.is_dir():
                members.extend(_iter_files(tdir))
        for fname in CONFIG_FILES:
            f = src / fname
            if f.is_file():
                members.append(f)

        for srcf in members:
            rel = srcf.relative_to(src)
            destf = dest / rel
            if not destf.exists():
                _copy(srcf, destf, apply)
                stats["copied"] += 1
            elif filecmp.cmp(srcf, destf, shallow=False):
                stats["skipped"] += 1
            else:
                # Divergent: newest mtime wins; loser archived.
                if srcf.stat().st_mtime > destf.stat().st_mtime:
                    loser, winner = destf, srcf
                else:
                    loser, winner = srcf, destf
                backup = dest / ".migration-backup" / profile / rel
                _copy(loser, backup, apply)
                if winner is srcf:
                    _copy(srcf, destf, apply)
                stats["conflicts"] += 1
                stats["backups"] += 1

    # 3. write unioned summons.log.
    if summons_lines:
        out = "\n".join(sorted(summons_lines)) + "\n"
        if apply:
            dest.mkdir(parents=True, exist_ok=True)
            (dest / "summons.log").write_text(out)

    return stats


def _copy(src: Path, dst: Path, apply: bool) -> None:
    if not apply:
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Merge per-profile global buddy state into ~/.buddy")
    ap.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    ap.add_argument("--home", default=str(Path.home()), help="HOME containing the .claude* profiles")
    ap.add_argument("--dest", default=None, help="destination (default: $BUDDY_HOME or <home>/.buddy)")
    args = ap.parse_args(argv)

    home = Path(args.home)
    if args.dest:
        dest = Path(args.dest)
    else:
        import os
        dest = Path(os.environ["BUDDY_HOME"]).expanduser() if os.environ.get("BUDDY_HOME") else home / ".buddy"

    stats = run(home=home, dest=dest, apply=args.apply)
    mode = "APPLIED" if args.apply else "DRY-RUN (no changes written; pass --apply)"
    print(f"[{mode}] dest={dest}")
    print(f"  sources: {', '.join(stats['sources']) or '(none)'}")
    print(f"  copied={stats['copied']} skipped={stats['skipped']} "
          f"conflicts={stats['conflicts']} backups={stats['backups']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
