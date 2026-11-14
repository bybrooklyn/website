/* AVIF through libavif and libaom, 8-bit, 4:2:0, all intra: RGBA8 in, an .avif file out. q is
   libavif's quality from 0 to 100, speed libaom's from 0 (slowest) to 10. */
#include "qabi.h"
#include "avif/avif.h"

QX int encode(uint8_t *p, int len, int w, int h, float q, int speed) {
  avifImage *im = avifImageCreate(w, h, 8, AVIF_PIXEL_FORMAT_YUV420);
  avifRGBImage rgb;
  avifRGBImageSetDefaults(&rgb, im);
  rgb.format = AVIF_RGB_FORMAT_RGBA; rgb.depth = 8; rgb.pixels = p; rgb.rowBytes = w * 4;
  im->alphaPremultiplied = AVIF_FALSE;
  if (avifImageRGBToYUV(im, &rgb) != AVIF_RESULT_OK) { avifImageDestroy(im); return -1; }
  /* metadata the page wrote with q_alloc: options 8 and 9 an Exif block's place and length, 10 and 11 an XMP packet's */
  if (q_o[8] && q_o[9] > 0) (void)avifImageSetMetadataExif(im, (const uint8_t *)(intptr_t)q_o[8], q_o[9]);
  if (q_o[10] && q_o[11] > 0) (void)avifImageSetMetadataXMP(im, (const uint8_t *)(intptr_t)q_o[10], q_o[11]);
  avifEncoder *e = avifEncoderCreate();
  e->quality = (int)q; e->qualityAlpha = 100; e->speed = speed; e->maxThreads = 1;
  avifRWData out = AVIF_DATA_EMPTY;
  avifResult r = avifEncoderWrite(e, im, &out);
  avifEncoderDestroy(e);
  avifImageDestroy(im);
  if (r != AVIF_RESULT_OK) { q_i[0] = r; return -2; }
  uint8_t *b = malloc(out.size);
  memcpy(b, out.data, out.size);
  size_t n = out.size;
  avifRWDataFree(&out);
  q_set_out(b, n);
  return (int)n;
}
