# To Do

## Separate Local And Production Data

- Keep local development on a separate MongoDB database, for example `BauDB-test`.
- Keep Fly.io production on the production database, for example `BauDB`.
- This prevents local drafts and production drafts from sharing upload references that point to different physical upload folders.

## Longer-Term Best Fix

Move uploaded files and pictures to Cloudflare R2.

MongoDB should store stable R2 object references or public/signed R2 URLs instead of local `/uploads/...` paths. That way, local and production can load the same draft media from one shared file store, instead of each server looking in its own local `uploads` directory.
