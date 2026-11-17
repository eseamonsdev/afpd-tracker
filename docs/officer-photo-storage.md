# Officer photo storage

Primary profile portraits stay at the root of `officer-photos/` in the
`afpd-public-media` R2 bucket, with stable names such as
`jaclyn-g-strong-photo.jpg`. Officer profile pages continue to link to those
originals.

Generated 96 × 96 WebP images go in `officer-photos/thumbnails/`, for example
`jaclyn-g-strong-thumbnail.webp`. The
`Generate officer photo thumbnails` GitHub Actions workflow scans only
root-level `*-photo.jpg`, `*-photo.jpeg`, `*-photo.png`, and
`*-photo.webp` objects. It skips unchanged sources, replaces a thumbnail when
its portrait changes, and verifies each upload by reading it back. Run the
workflow on staging after adding photos, or wait for its daily schedule once
the workflow is on the default branch. Changes to the workflow or script on
staging also run it automatically.

Other career photographs belong under `officer-photos/additional/`, with
descriptive names and source information recorded on the relevant profile.
They are not automatically turned into profile thumbnails. The generator
does not move or delete existing objects.
