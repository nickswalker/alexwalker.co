## File sizes

Target the below sizes. 50-60% JPEG quality is typically sufficient. Consider
using [WebP](https://developers.google.com/speed/webp) for new images.

| Image role      | File Size |
|-----------------|-----------|
| 4K slider       | 400KB     |
| Still thumbnail | 75KB      |

Finally, do a pass of lossless compression with [ImageOptim](https://imageoptim.com)

See overall site resource distribution and statistics with [Pingdom speed test](https://tools.pingdom.com).

## "-super" Folders

Images that need to be displayed in high resolution (for retina displays), use the `-super` folder for the high resolution image, then include a half-resolution image in the non `-super` directory.

## ogimage.jpg

This file will be used as the banner image whenever the site is shared on Facebook. Its dimensions should be 1200 x 630.
