# Radio audio storage

New radio audio goes to `afpd-public-media` in R2. Metadata, transcripts,
validation and generated pages stay on staging. Existing tracked audio stays in
Git; this change does not migrate or delete it or fix the current deployment
file count on its own.

Secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
Variables: `R2_BUCKET_NAME`, `R2_ENDPOINT` (HTTPS S3 endpoint).
Credentials need Object Read & Write access to that bucket only.

The manifest download, day queues, retry, recovery and ZIP workflows share the
checkpoint uploader. It uploads new recordings, reads them back and compares
SHA-256 and byte count before committing `audio_storage` metadata. An existing
object with different bytes aborts the checkpoint; no objects are deleted.
Original source downloads retain their two-second pacing. Git ignores new audio;
tracked historical backups remain. Failed uploads do not publish queue changes.

The Worker binds the bucket as `RADIO_AUDIO`. Existing radio URLs work through
GET/HEAD with byte ranges after the Worker is deployed; unrelated bucket keys
are inaccessible. Public bucket access is not required.

ASR scripts hydrate R2-only audio and verify hashes before reading it. Local ASR
needs the same four environment settings. Manual hydration:
`python scripts/r2_audio.py --hydrate public/records/openmhz/<archive-folder>`.

Historical audio migration is separate: copy and verify all objects before
excluding tracked audio from deployment. Do not exclude it before playback is
verified. The connection test leaves a harmless text object in `_connection-tests`;
the integration test copies one existing radio clip without changing its manifest.
