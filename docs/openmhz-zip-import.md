# Historical ZIP import

The automatic ZIP-import workflow and its daily polling schedule have been
removed. Normal radio collection now uses the direct-to-R2
[audio action](radio-workflows.md), parameterized by date, talkgroup and branch.

`scripts/import_openmhz_zips.py` remains a local validation/import utility for
historical Car-to-Car and Law 2 bundles. It validates paths, call identities,
audio hashes and duplicate source records before extraction. It does not fetch
new OpenMHz audio. It is not an unattended entry point and is not required for
daily audio downloads or transcription.
