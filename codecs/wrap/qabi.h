/* The few calls every encoder module answers, the same in C and in Rust (codecs/rust/glue): the page
   asks for room with q_alloc and writes the picture's RGBA8 there, sets options with q_opt, calls
   encode(ptr, len, width, height, quality, speed), which gives the file's length (or a negative number
   on failure), and reads the file from q_out_ptr. q_info gives a failure's code. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define QX __attribute__((used, visibility("default")))
static uint8_t *q_out = 0;
static size_t q_out_len = 0;
static int q_o[16];
static int q_i[4];
QX void *q_alloc(int n) { return malloc((size_t)n); }
QX void q_free(void *p) { free(p); }
QX uint8_t *q_out_ptr(void) { return q_out; }
QX int q_info(int i) { return (i >= 0 && i < 4) ? q_i[i] : 0; }
QX void q_opt(int k, int v) { if (k >= 0 && k < 16) q_o[k] = v; }
static void q_set_out(uint8_t *p, size_t n) { if (q_out) free(q_out); q_out = p; q_out_len = n; }
