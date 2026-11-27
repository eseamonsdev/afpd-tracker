# Examples needing assignment review

`pending-samples.json` preserves 24 reviewed word occurrences that cannot yet be
assigned confidently to the existing vocabulary entries: 19 Sam mentions and
five Millpond/Mill Pond mentions. These are not active samples for any officer,
community, or landmark.

Each entry contains the word, full reviewed sentence, recording details, saved
Allosaurus result key, automatically extracted word sounds where available,
candidate vocabulary entries, and the reason for review. No word timestamps are
stored. The same extraction limits described in `../vocabulary/README.md` apply.

Review the audio and surrounding exchange before moving an entry into a form's
`samples` array. A Millpond reference may require a separate road entry rather
than either of the existing apartment/pond entries. A shared first name alone
does not choose an officer. Do not infer or change a radio association from this
review queue.
