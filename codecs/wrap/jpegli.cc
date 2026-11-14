// JPEG through jpegli's libjpeg API: RGBA8 in, a progressive 4:2:0 .jpg out. q is the quality from 0 to
// 100; speed is not used. A JPEG has no transparency: the page lays the picture on white first.
#include "lib/jpegli/encode.h"
extern "C" {
#include "qabi.h"

QX int encode(uint8_t *p, int len, int w, int h, float q, int speed) {
  struct jpeg_compress_struct ci;
  struct jpeg_error_mgr je;
  unsigned char *mem = 0;
  unsigned long size = 0;
  ci.err = jpegli_std_error(&je);
  jpegli_create_compress(&ci);
  jpegli_mem_dest(&ci, &mem, &size);
  ci.image_width = w; ci.image_height = h; ci.input_components = 4; ci.in_color_space = JCS_EXT_RGBA;
  jpegli_set_defaults(&ci);
  jpegli_set_quality(&ci, (int)q, TRUE);
  jpegli_simple_progression(&ci);
  jpegli_start_compress(&ci, TRUE);
  while (ci.next_scanline < ci.image_height) {
    JSAMPROW row = p + (size_t)ci.next_scanline * w * 4;
    jpegli_write_scanlines(&ci, &row, 1);
  }
  jpegli_finish_compress(&ci);
  jpegli_destroy_compress(&ci);
  q_set_out(mem, size);
  return (int)size;
}
}
