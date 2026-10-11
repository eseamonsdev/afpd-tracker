# afpd-tracker

The AFPD radio ID comparison is in `public/records/openmhz/afpd-radio-ids.json`.
It combines radio IDs from archived Car-to-Car (6001) calls and the captured
American Fork Police (6036) inventory. It includes the complete source call ID
lists, IDs shared by both talkgroups, and calls with unavailable radio metadata.
Its coverage is recorded in the JSON; it is not a complete live history.

Regenerate after importing call metadata with:

```sh
python3 scripts/build_afpd_radio_ids.py
```
