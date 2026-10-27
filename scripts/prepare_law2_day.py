"""Compatibility entry point. New callers use prepare_radio_day.py --talkgroup 5922."""
import argparse
import json
from pathlib import Path
from prepare_radio_day import prepare as prepare_day


def prepare(root, day):
    return prepare_day(root, day, 5922)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--date', required=True)
    p.add_argument('--root', type=Path, default=Path.cwd())
    a = p.parse_args()
    print(json.dumps(prepare(a.root.resolve(), a.date)))
