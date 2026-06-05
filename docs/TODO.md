# To Do

## Move Uploads To Cloudflare R2

Move uploaded files and pictures to Cloudflare R2.

MongoDB should store stable R2 object references or public/signed R2 URLs instead of local `/uploads/...` paths. That way, local and production can load the same draft media from one shared file store, instead of each server looking in its own local `uploads` directory.

- check if we can make man tries successviely when there is failure submit, as second option, and third option will be sending in 2 or 3 comments



