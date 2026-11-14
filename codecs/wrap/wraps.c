/* Targets of -Wl,--wrap: libc text output and getenv become no-ops. */
#include <stdio.h>
#include <stdarg.h>
int __wrap_fprintf(FILE *f, const char *fmt, ...) { return 0; }
int __wrap_vfprintf(FILE *f, const char *fmt, va_list a) { return 0; }
int __wrap_printf(const char *fmt, ...) { return 0; }
int __wrap_fputs(const char *s, FILE *f) { return 0; }
int __wrap_puts(const char *s) { return 0; }
int __wrap_fputc(int c, FILE *f) { return c; }
size_t __wrap_fwrite(const void *p, size_t s, size_t n, FILE *f) { return n; }
int __wrap_fflush(FILE *f) { return 0; }
char *__wrap_getenv(const char *n) { return 0; }
