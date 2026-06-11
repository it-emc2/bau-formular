# To Do

## Move Uploads To Cloudflare R2

Move uploaded files and pictures to Cloudflare R2.

MongoDB should store stable R2 object references or public/signed R2 URLs instead of local `/uploads/...` paths. That way, local and production can load the same draft media from one shared file store, instead of each server looking in its own local `uploads` directory.


chat
- test the last changements done in chat : "yes do this ...."
- keep working on "complete video ui for video, moving storage


