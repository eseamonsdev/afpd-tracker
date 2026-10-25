# One-day screen of additional talkgroups for AFPD-associated radio IDs

Review date: October 24, 2026. Target day: October 22, 2026, America/Denver.

## Result

One exact source-radio overlap was found: **13230584 on talkgroup 6003**, in call `6adaf4f3b4f715390cf68e2c` at **11:47:25 PM Mountain** (epoch 1792734445). OpenMHz shows `14570735[0]` and `13230584[2.16]` in that call's source list. This is a multi-source metadata observation; it does not identify an AFPD officer or establish who spoke.

The comparison source is [afpd-radio-ids.json](../public/records/openmhz/afpd-radio-ids.json), retrieved from staging during this review. It contains 109 entries, including the non-identifying placeholders -1 and 0; those placeholders were excluded. Its labels mean radios previously observed on 6001/6036, not independently confirmed ownership or officer identities. Its entry for 13230584 records five calls on 6001 and one on 6036.

## Coverage

This was an initial screen across all eleven suggested channels, not an exhaustive source-ID census of every busy channel. The sparse active channels were inspected in full for the target day. For the busier channels, call-detail samples were inspected; absence from those samples cannot establish absence throughout the day.

| Talkgroup | Current OpenMHz label | October 22 result and coverage |
| --- | --- | --- |
| 6002 | Police Car to Car (city unknown) | All 7 exposed calls checked: no exact match. Six expose valid IDs; one reports only 0. |
| 6003 | Utah County Sheriff - Eagle Mtn Car to Car | 359 unique calls exposed within the Mountain day; 20 call-detail samples across the listing checked. One sampled call includes 13230584. |
| 6223 | Law Operations 1 | No calls exposed for October 22; the latest preceding listing was October 17. |
| 6224 | Law Operations 2 | No calls exposed for October 22; the latest preceding listing was October 20. |
| 6225 | Law Operations 3 | All 26 exposed calls checked. Sources 14730188 and 14730195; neither matches. |
| 6226 | Law Operations 4 | No calls exposed for October 22; the latest preceding listing was October 20. |
| 6227 | Law Operations 5 (previously suggested label) | The date-filtered archive exposed no rows; no source-ID comparison was possible. |
| 5964 | Events 1 | No calls exposed for October 22; the latest preceding call was October 21, 11:30:28 PM Mountain. |
| 5965 | Events 2 | No calls exposed for October 22; the latest preceding listing was October 17. |
| 5921 | Law 1 Northwest | Morning, afternoon, and evening source-ID samples: no exact match. This is not a full-day negative. |
| 5924 | Law 4 | Morning, afternoon, and evening source-ID samples: no exact match. This is not a full-day negative. |

## Exact-match checks and limitations

The 6002 valid source IDs were 14570099, 14570328, 14570150, and 14570095. The 6225 source IDs were 14730188 and 14730195.

An interim observation incorrectly treated 9040001 on Law 1 as matching 9400001. These are different IDs. Exact string comparison confirms 9040001 and 9040004 are absent from the comparison list; the false Law 1 match was withdrawn.

The browser displayed Pacific time. Review boundaries were October 21 at 11 PM Pacific through October 22 at 11 PM Pacific, corresponding to October 22 midnight through October 23 midnight Mountain. Sample timestamps were converted using their epoch values. Calls were selected with autoplay disabled and at least two seconds between selections. One evening Law 4 observation whose selected-call link did not match its requested row was discarded. The source IDs were read from the normal call-detail panel, not inferred from speech or channel labels.

No transcripts, officer associations, or validation flags were changed. No full audio-download archive was created for these additional channels. A shared radio ID, especially a secondary source in a multi-source recording, is insufficient by itself to confirm AFPD use of a channel. No independently identified AFPD field radio was established by this screen.

## Sources

- [6003 matching call](https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6003&call-id=6adaf4f3b4f715390cf68e2c&time=1792734445001)
- [6003 date listing](https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6003&time=1792735200000)
- [6002 date listing](https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6002&time=1792735200000)
- [6225 date listing](https://openmhz.com/system/dcfems?filter-type=talkgroup&filter-code=6225&time=1792735200000)
- [Repository comparison list](https://github.com/eseamonsdev/afpd-tracker/blob/staging/public/records/openmhz/afpd-radio-ids.json)
