"""Shared identities for repeatable radio jobs; branches do not imply talkgroups."""
from datetime import date
from pathlib import Path

TALKGROUPS = {
    6001: ('car-to-car', 'American Fork PD Car to Car'),
    5922: ('law-2', 'Law 2 Northeast'),
    6036: ('6036', 'American Fork PD Car to Car Private'),
}
BRANCHES = ('staging',)
DEFAULT_PAUSE_MS = 1000


def valid_pause_ms(value):
    if isinstance(value, bool) or not str(value).isdigit():
        raise ValueError('pause_ms must be a nonnegative integer in milliseconds')
    return int(value)


def valid_day(day):
    if not isinstance(day, str) or date.fromisoformat(day).isoformat() != day:
        raise ValueError('Day must use YYYY-MM-DD')
    return day


def valid_talkgroup(value):
    if isinstance(value, bool) or str(value) not in {str(t) for t in TALKGROUPS}:
        raise ValueError('Supported talkgroups: 6001, 5922, 6036')
    return int(value)


def valid_branch(branch):
    if branch not in BRANCHES:
        raise ValueError('Target branch must be staging')
    return branch


def archive_path(root, day, talkgroup):
    return Path(root) / 'public/records/openmhz' / f'openmhz-afpd-{TALKGROUPS[valid_talkgroup(talkgroup)][0]}-{valid_day(day)}'


def metadata_paths(day, talkgroup):
    channel = TALKGROUPS[valid_talkgroup(talkgroup)][0]
    return [Path('records-pending-review/openmhz-metadata') / label / valid_day(day) / 'calls.json'
            for label in dict.fromkeys((channel, str(talkgroup)))]
