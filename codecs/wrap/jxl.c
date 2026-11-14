/* JPEG XL through libjxl: RGBA8 in, a .jxl file out. q is the quality from 0 to 100 (libjxl turns it
   into a distance), speed the effort from 1 to 9; option 0 set to 1 makes it lossless. */
#include "qabi.h"
#include "jxl/encode.h"

QX int encode(uint8_t *p, int len, int w, int h, float q, int speed) {
  JxlEncoder *e = JxlEncoderCreate(NULL);
  JxlBasicInfo bi;
  JxlEncoderInitBasicInfo(&bi);
  bi.xsize = w; bi.ysize = h; bi.bits_per_sample = 8; bi.num_color_channels = 3;
  bi.num_extra_channels = 1; bi.alpha_bits = 8;
  bi.uses_original_profile = q_o[0] ? JXL_TRUE : JXL_FALSE;
  if (JxlEncoderSetBasicInfo(e, &bi)) { JxlEncoderDestroy(e); return -1; }
  JxlColorEncoding ce;
  JxlColorEncodingSetToSRGB(&ce, JXL_FALSE);
  JxlEncoderSetColorEncoding(e, &ce);
  JxlEncoderFrameSettings *fs = JxlEncoderFrameSettingsCreate(e, NULL);
  JxlEncoderFrameSettingsSetOption(fs, JXL_ENC_FRAME_SETTING_EFFORT, speed);
  if (q_o[0]) JxlEncoderSetFrameLossless(fs, JXL_TRUE);
  else JxlEncoderSetFrameDistance(fs, JxlEncoderDistanceFromQuality(q));
  JxlPixelFormat pf = {4, JXL_TYPE_UINT8, JXL_NATIVE_ENDIAN, 0};
  if (JxlEncoderAddImageFrame(fs, &pf, p, (size_t)w * h * 4)) { JxlEncoderDestroy(e); return -2; }
  JxlEncoderCloseInput(e);
  size_t cap = 1 << 20, used = 0;
  uint8_t *buf = malloc(cap);
  for (;;) {
    uint8_t *next = buf + used;
    size_t avail = cap - used;
    JxlEncoderStatus s = JxlEncoderProcessOutput(e, &next, &avail);
    used = next - buf;
    if (s == JXL_ENC_SUCCESS) break;
    if (s != JXL_ENC_NEED_MORE_OUTPUT) { free(buf); JxlEncoderDestroy(e); return -3; }
    cap *= 2;
    buf = realloc(buf, cap);
  }
  JxlEncoderDestroy(e);
  q_set_out(buf, used);
  return (int)used;
}
