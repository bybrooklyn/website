/* WebP through libwebp: RGBA8 in, a .webp file out. q is the quality from 0 to 100, speed the method
   from 0 to 6 (for lossless, the preset level from 0 to 9); option 0 set to 1 makes it lossless. */
#include "qabi.h"
#include "webp/encode.h"

QX int encode(uint8_t *p, int len, int w, int h, float q, int speed) {
  WebPConfig c;
  WebPPicture pic;
  WebPMemoryWriter wr;
  if (!WebPConfigInit(&c)) return -1;
  if (q_o[0]) WebPConfigLosslessPreset(&c, speed);
  else c.method = speed;
  c.quality = q;
  if (!WebPPictureInit(&pic)) return -2;
  pic.use_argb = q_o[0] ? 1 : 0; pic.width = w; pic.height = h;
  if (!WebPPictureImportRGBA(&pic, p, w * 4)) return -3;
  WebPMemoryWriterInit(&wr);
  pic.writer = WebPMemoryWrite; pic.custom_ptr = &wr;
  int ok = WebPEncode(&c, &pic);
  WebPPictureFree(&pic);
  if (!ok) { q_i[0] = pic.error_code; WebPMemoryWriterClear(&wr); return -4; }
  q_set_out(wr.mem, wr.size);
  return (int)wr.size;
}
