# Three-pass calibration — October 16, 2026

All three actual small.en passes completed on September 9 clips 3, 7, 10, 18,
19, 24, 39, 52, 117, 220, 343 and 355. Additional preceding clips received the
original pass solely to supply context. Existing user-validated transcript fields
were comparison references, never supplied to the ASR as hints. No existing
transcripts or audio were changed. No sampled pass reached the token cap.

This was a deliberately difficult operational sample, not a random accuracy
estimate. Read all three outputs against the saved corrections. Findings:

- Clip 3: known static produced stock closing phrases. Suppress such unsupported
  speech and retain a bracketed static/unclear entry.
- Clip 7: wording aligned, but the reference's question punctuation matters.
- Clip 10: all three returned “On the list”; the approved reference is “On my way.”
- Clips 18, 19 and 24: name/spelling disagreements require uncertainty; majority
  agreement is insufficient to establish a name.
- Clip 39: original/context wording aligned with the reference; filtered opening
  differed. Filtering does not always improve recognition.
- Clip 52: filtering improved a place name while losing the ending. Reconcile
  the whole conversation without silently asserting disputed proper nouns.
- Clip 117: all passes agreed with one another but differed materially from the
  user-approved wording. This is another demonstrated shared ASR error.
- Clips 220 and 343: mostly stable speech still had pronoun, wording or missing-word
  differences from the references.
- Clip 355: short differing outputs do not resolve an approved unclear acknowledgment.

Conclusion: the runner performs the requested three-pass method, but this test
does not establish historical quality equivalence or guarantee that unflagged
text is correct. Assistant reconciliation and conservative uncertainty remain
mandatory. Never overwrite user corrections with these new outputs.

The test caught and fixed PyAV 19 incompatibility by pinning PyAV 16.0.1. Three
publication/context guard tests pass, including initial-draft equality, withholding
uncertain text, metadata preservation and rejection of an overwrite rerun.
