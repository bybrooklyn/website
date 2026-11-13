# imgQuire codecs

13 November 2026.

Which Rust crates could give imgQuire the formats a browser cannot write or read, built to WebAssembly
and fetched only when a format is picked. Each was looked up on crates.io and in its repository, and the
leading ones were built and run. Nothing here is in the site yet.

Browsers write only PNG, JPEG and WebP from a canvas. imgQuire wants AVIF and JPEG XL out, better JPEG,
PNG and WebP than the browser's own encoders, and to read JPEG XL, HEIC, camera raw, TIFF and the rest,
with EXIF, IPTC and XMP read and written.

Module sizes are in KB of 1024 bytes. Picture file sizes are in kB of 1000 bytes. "Brotli" means
brotli at level 11 of the module after `wasm-opt -Oz`, which is close to what Cloudflare Pages sends.
Times are for one thread in Node 22 on an AMD Ryzen 7 9700X; a browser on a laptop will be slower,
perhaps by half again.

## The short answer

The suggested build is `opt-level = "s"` with SIMD128, the standard library rebuilt for size and panics
that abort at once (see "Measured"). Downloads below are for that build where it was made, otherwise for
`"z"` with SIMD128. Times are for the same build.

| Format | Crate | Download (brotli) | 12 MP photo, one thread | Licence |
|---|---|---|---|---|
| JPEG XL out | `jxl-encoder` 0.3.4 | 216 KB | about 2.5 s at effort 3, 13 s at effort 7 | AGPL-3.0 or paid |
| JPEG XL out, free licence | `zune-jpegxl` 0.5.2 | 22 KB | 0.5 s, lossless only | MIT/Apache/Zlib |
| AVIF out | `ravif` 0.13.0 (rav1e) | 184 KB | 28 s at speed 6 (22 s at `opt-level 3`) | BSD |
| JPEG out | `zenjpeg` 0.8.4 | 70 KB | 0.5 s | AGPL-3.0 or paid |
| JPEG out, free licence | `jpeg-encoder` 0.7.1 | 10 KB | 0.2 s | MIT/Apache and IJG |
| PNG out | `oxipng` 10.2.1 | 61 KB | 6 s at level 2 | MIT, with C inside |
| PNG palette | `quantette` 0.6.0 | 18 KB | 0.3 s (Wu), 2 s (k-means) | MIT/Apache |
| WebP out | `zenwebp` 0.4.6 | 86 KB | 2.2 s lossy, about 10 s lossless | AGPL-3.0 or paid |
| WebP lossless, free licence | `image-webp` 0.2.4 | 52 KB | 0.14 s | MIT/Apache |
| JPEG XL in | `jxl` 0.8.0 (jxl-rs) | 237 KB | 0.5 s | BSD-3 |
| HEIC in | `heic-rs` 0.1.4 | 47 KB | 1.1 s | MIT/Apache |
| Raw in | `rawloader` 0.37.2 | 132 KB | 0.13 s to the sensor data | LGPL-2.1 |
| TIFF in | `tiff` 0.11.3 | 37 KB | instant | MIT |
| EXIF write | `little_exif` 0.6.23 | 32 KB | instant | MIT/Apache |
| Colour (ICC) | `moxcms` 0.9.2 | 66 KB | 48 ms | BSD-3/Apache |

A later trial built the reference C and C++ encoders to WebAssembly with Emscripten. Under the rule of
permissive licences only, those replace most of this table; see "C encoders built with Emscripten" and
"Revised recommendation per format, with C encoders".

The best encoders written in pure Rust in 2026 come from one maintainer, Imazen, and are AGPL-3.0 or a
paid licence (`jxl-encoder`, `zenjpeg`, `zenwebp`, `heic`, `zenavif`). The startup licence is US$1 for a
company under US$1M revenue and fewer than five people. Everything else recommended here is MIT, Apache,
BSD or Zlib, apart from raw (LGPL). See "Licences and patents that are a problem".

## How each was tried

A small Cargo workspace in `/home/brook/.cache/quire-codec-trials/ws/`. Each candidate is a `cdylib` with
two or three `extern "C"` functions: `q_alloc` for the page to write into, `encode(ptr, len, w, h, q,
speed)` from RGBA8 to file bytes or `decode(ptr, len)` to RGBA8, and `q_out_ptr` to read the result. No
`wasm-bindgen`. Every build is `wasm32-unknown-unknown` with `lto = "fat"`, `codegen-units = 1`,
`panic = "abort"`, `strip = true`, default features off where the crate allowed it, and
`-C target-feature=+bulk-memory` plus `+simd128` or `-simd128`.

Seven configurations were built: `opt-level` `"z"`, `"s"` and `3`, each with and without SIMD128, and a
seventh that rebuilds the standard library (see "Measured").

Tools on the machine: Rust 1.99.0 stable, `wasm32-unknown-unknown` target, `rust-src`, clang 21 with a
wasm target, brotli, zstd, gzip, Node 22, Bun, cjxl 0.12.0, avifenc, heif-enc, ImageMagick 7. There was
no nightly toolchain and no system `wasm-opt`. `wasm-opt` came from the npm package `binaryen@132.0.0`,
installed only inside the scratch folder.

Test pictures, made by `harness/gen.mjs`:

- **photo12**: 4000 by 3000, soft colour blobs, a sky gradient, a fine woven texture and Gaussian noise
  (sigma 6). The noise is harder to compress than a clean phone photo, so lossless sizes are large.
- **screen**: 1920 by 1080, flat panels, a title bar, about 70 lines of black glyph strokes with hard
  edges, and a small photo inset. The glyphs are random pixels, so they are harder than real text.

Native tools gave reference files: cjxl for JPEG XL, avifenc (libaom) for AVIF, heif-enc for a 12 MP
HEIC, libjpeg-turbo 3.2.1 `cjpeg`, and ImageMagick with libwebp 1.6.0. A Sony A7 III raw file
(`_DSC0009.ARW`, 24 MP) came from raw.pixls.us, a public sample archive.

Quality was measured with ImageMagick `compare` against the source, as PSNR in dB (higher is closer) and as its SSIM distortion (0 is identical, lower is closer). These
are rough. They are enough to show when one file is both smaller and closer than another.

## 1. JPEG XL encode

| Crate | Version, date | Licence | Kind | wasm32 build | Notes |
|---|---|---|---|---|---|
| `jxl-encoder` | 0.3.4, 25 Oct 2026 | AGPL-3.0-only OR Imazen commercial | pure Rust, `forbid(unsafe)`, `no_std` + alloc | builds and runs | The one asked about. Lossy VarDCT and lossless Modular, effort 1 to 13, progressive, animation, alpha, 16-bit and float, HDR (PQ, HLG), patches, ICC, EXIF and XMP boxes, JPEG transcode. Optional `rayon` threads. 47k downloads. |
| `zune-jpegxl` | 0.5.2, Jan 2026 | MIT OR Apache-2.0 OR Zlib | pure Rust | builds and runs | Lossless Modular only, port of libjxl's fast-lossless. Effort setting, 8 and 16 bit, optional threads. 500k downloads. |
| `jpegxl-rs` / `jpegxl-sys` | 0.16.0, Oct 2026 | GPL-3.0-or-later (the binding; libjxl itself is BSD-3) | C++ bindings | not tried; needs a C++ toolchain and libc, and fails for the same reason mozjpeg did | Full libjxl. |
| `gamut-jxl` | 0.5.0, Oct 2026 | MIT OR Apache-2.0 | encode wraps libjxl in C++ (emscripten only); decode is jxl-rs | not tried | Part of the gamut family. |
| `jxl-oxide` | 0.12.6, May 2026 | MIT OR Apache-2.0 | pure Rust decoder | builds and runs | Mature, 3.1M downloads, conformance tested. `rayon` optional. |
| `jxl` (jxl-rs) | 0.8.0, Oct 2026 | BSD-3-Clause | pure Rust decoder | builds and runs | From the libjxl project. Chromium uses it: Chrome ships JPEG XL decoding from version 155 (Chrome blog, 6 Oct 2026). Has a `simd128` feature that must be turned on by hand. |
| `oxideav-jpegxl` | 0.0.15, Nov 2026 | MIT | pure Rust decoder | not tried | Young, clean-room. |

Measured, effort and distance as cjxl uses them (distance 1 looks lossless):

| Picture | Setting | `jxl-encoder` wasm | cjxl native, 1 thread |
|---|---|---|---|
| photo12 | d1 e7 | 2418 kB, 39.6 dB, 8.5 s | 2217 kB, 39.1 dB, 3.1 s |
| photo12 | d1 e3 | 2370 kB, 39.7 dB, 1.6 s | not run |
| photo12 | d2 e5 | 798 kB, 34.8 dB, 4.2 s | 717 kB, 34.9 dB, 1.9 s |
| photo12 | lossless e3 | 16 625 kB, 2.3 s | 11 705 kB, 1.7 s |
| screen | d1 e7 | 627 kB, 43.6 dB, 1.8 s | 660 kB, 43.2 dB, 0.5 s |
| screen | d2 e5 | 516 kB, 38.2 dB, 0.9 s | 515 kB, 38.3 dB, 0.3 s |
| screen | lossless e3 | 1290 kB, 0.4 s | 1188 kB, 0.25 s |
| screen | lossless e7 | 374 kB, 6.4 s | not run |

`zune-jpegxl` lossless: photo12 13 548 kB in 0.53 s; screen 1030 kB in 45 ms.

So `jxl-encoder` in WebAssembly makes files about as small as cjxl at d1 and up to 11 percent larger at
d2, and is two to three times slower than native cjxl on one thread. Effort 3 at d1 gives nearly the
same file as effort 7 in a fifth of the time. Peak memory was 0.7 to 1.5 GB for 12 MP, which a phone may
refuse; the crate has `Limits` and `estimate_peak_memory_bytes` to check first.

The README states that parts were written with Claude and "not all code has been manually reviewed".
Every output decoded with ImageMagick (libjxl) without error here.

## 2. AVIF encode

| Crate | Version, date | Licence | Kind | wasm32 build | Notes |
|---|---|---|---|---|---|
| `ravif` | 0.13.0, Jan 2026 | BSD-3-Clause | pure Rust, on `rav1e` 0.8.1 (BSD-2) and `avif-serialize` | builds and runs with `default-features = false` (no `asm`, no `threading`) | Powers `cavif`. 61M downloads, mostly through the `image` crate. Quality 1 to 100, speed 1 to 10, 8 or 10 bit, alpha, EXIF. No lossless. |
| `gamut-avif` | 2.0.0, Oct 2026 | MIT OR Apache-2.0 | pure Rust, its own AV1 intra encoder (`gamut-av1`) | builds and runs | Lossless and lossy, 8/10/12 bit. Four speed presets. 181k downloads. Young. |
| `zenavif` | 0.1.6, May 2026 | AGPL-3.0-only OR commercial | pure Rust, rav1d and a fork of ravif | not tried | Imazen. |
| `libavif` / `libavif-sys` | 0.14.0, 2024 | BSD-2-Clause | C bindings | not tried | Needs a C toolchain with libc; unmaintained since 2024. |
| `avif-rs` | 26.10.3 | see crate | C bindings to libavif with SVT-AV1 and dav1d | not tried | |
| `svt-av1-enc`, `shiguredo_svt_av1` | 0.1.2 (2025), 2026.2.0 | MIT/Apache, Apache-2.0 | C bindings to SVT-AV1 | not tried | SVT-AV1 is large C with assembly; no wasm32-unknown-unknown path. |
| `avif-serialize` | 0.8.9 | BSD-3-Clause | pure Rust | used inside ravif | Writes the AVIF boxes around an AV1 stream. |
| Decoders: `rav1d` 1.1.0 (BSD-2, Rust port of dav1d), `dav1d` 0.11.1 (MIT, C bindings), `avif-parse` 2.1.0 (MPL-2.0), `avif-decode` 3.0.0 (BSD-3) | | | | not tried | Every current browser reads AVIF, so imgQuire needs no AVIF decoder. |

rav1e speed presets (from its docs and cavif's): 1 is very slow and 3 to 5 percent smaller; 4 is cavif's
default; 6 is rav1e's default; 7 and above lose compression fast; 10 is quick and blurry.

| Picture | Setting | `ravif` wasm, 1 thread | avifenc (libaom) native, 1 thread |
|---|---|---|---|
| photo12 | q80 speed 6 | 1553 kB, 36.7 dB, 21 to 22 s | q80 s6: 2780 kB, 40.0 dB, 3.7 s |
| photo12 | q80 speed 4 | 1600 kB, 37.0 dB, 59 s | q80 s4: 2904 kB, 40.8 dB, 25 s |
| photo12 | q60 speed 8 | 520 kB, 33.5 dB, 20.5 s | q60 s8: 1162 kB, 34.6 dB, 0.6 s |
| screen | q80 speed 6 | 508 kB, 37.2 dB, 3.8 s | q80 s6: 154 kB, 50.7 dB, 0.7 s |
| screen | q60 speed 8 | 414 kB, 33.6 dB, 2.9 s | q60 s8: 119 kB, 44.2 dB, 0.16 s |

The two quality scales differ, so compare along the curve, not row by row. Two things stand out. A 12 MP
photo takes about 20 seconds in one thread whatever the speed from 6 to 8, so it needs threads to be
pleasant. And rav1e has no screen-content tools (palette, intra block copy) that libaom uses: on the
screenshot libaom made a file a third the size at far higher quality. AVIF is a poor choice for
screenshots from imgQuire; JPEG XL lossless or WebP lossless are better there.

`gamut-avif` at its fastest preset took 131 s for photo12 and 17 s for the screenshot, at 31 dB and 25 dB.
Its balanced preset took 453 s for the photo. It is not usable yet.

Threads: `ravif` with its `threading` feature uses rayon to encode tiles in parallel. In WebAssembly that
needs the `atomics` target feature, a rebuilt standard library (nightly), `wasm-bindgen-rayon` or
something like it, and cross-origin isolation, which mdQuire's pages already have. It was not measured
here. rav1e scales well with tiles; four to eight threads should bring a 12 MP photo to 4 to 7 seconds.

## 3. Better JPEG

| Crate | Version, date | Licence | Kind | wasm32 build | Notes |
|---|---|---|---|---|---|
| `zenjpeg` (was `jpegli-rs`) | 0.8.4, Jun 2026 | AGPL-3.0-only OR commercial | pure Rust | builds and runs | Started as a port of Google's jpegli, now its own: adaptive quantisation, XYB, perceptual tables, mozjpeg-style trellis and deringing, progressive. Also decodes. Contains SIMD128 code even in the scalar build. |
| `jpeg-encoder` | 0.7.1, Jul 2026 | (MIT OR Apache-2.0) AND IJG | pure Rust | builds and runs | Used by `image`. Baseline and progressive, optimised Huffman tables, chroma subsampling, no trellis. 10M downloads. |
| `mozjpeg` | 0.10.13, Feb 2025 | IJG (C is IJG/BSD/zlib) | C bindings | **fails**: `stdlib.h` not found; wasm32-unknown-unknown has no C library | Would need emscripten or a WASI sysroot plus shims. |
| `jpegli` | 0.1.0, 2024 | BSD-3-Clause | C++ bindings | not tried | Abandoned. |
| `gamut-jpeg`, `oxiarc-jpeg` | 0.1.0, 0.4.2 | MIT/Apache | pure Rust | not tried | Young. |
| `zune-jpeg`, `jpeg-decoder` | | MIT/Apache/Zlib | pure Rust decoders | not needed | Browsers read JPEG. |

| Picture | Encoder | Size | PSNR | SSIM distortion | Time |
|---|---|---|---|---|---|
| photo12 | libjpeg-turbo baseline q75 (like a browser) | 1484 kB | 33.9 | 0.112 | native |
| photo12 | libjpeg-turbo baseline q85 | 2449 kB | 35.1 | 0.078 | native |
| photo12 | libjpeg-turbo q85, optimised, progressive | 2156 kB | 35.1 | 0.078 | 0.3 s native |
| photo12 | `jpeg-encoder` q85, optimised, progressive | 2288 kB | 35.1 | 0.078 | 0.2 s |
| photo12 | `zenjpeg` q85 progressive | 1364 kB | 34.9 | 0.093 | 0.4 s |
| photo12 | `zenjpeg` q75 progressive | 610 kB | 33.2 | 0.145 | 0.4 s |
| screen | libjpeg-turbo q85, optimised, progressive | 655 kB | 36.1 | 0.0086 | native |
| screen | `jpeg-encoder` q85, optimised, progressive | 707 kB | 36.1 | 0.0086 | 33 ms |
| screen | `zenjpeg` q85 progressive | 621 kB | 35.6 | 0.0090 | 81 ms |

`zenjpeg` at q85 is smaller than the browser-like q75 file (1364 kB against 1484 kB) and closer to the
source by both measures. `jpeg-encoder` gains only what optimised tables and progressive scans give,
about 7 percent over a browser at the same quality, from a 10 KB module.

## 4. Better PNG

| Crate | Version, date | Licence | Kind | wasm32 build | Notes |
|---|---|---|---|---|---|
| `oxipng` | 10.2.1, Sep 2026 | MIT | Rust, but compresses with libdeflate (C, MIT) | builds and runs only with its `freestanding` feature, which compiles libdeflate without a C library; needs clang with a wasm target at build time | Filter search, bit depth and palette reduction, optional Zopfli. 2.4M downloads. |
| `zopfli` | 0.8.4, Oct 2026 | Apache-2.0 | pure Rust | used inside oxipng | Slow and a little smaller. |
| `png` | 0.18.1, Feb 2026 | MIT OR Apache-2.0 | pure Rust | builds and runs | The image-rs encoder and decoder; also APNG. |
| `zenpng`, `zenzop` | 0.1.4, 0.4.2 | AGPL or commercial; Apache-2.0 | pure Rust | not tried | |
| `gamut-png`, `gamut-deflate` | 0.1.0, 0.1.1 | MIT/Apache | pure Rust | not tried | Young; aimed at small files. |
| `imagequant` | 4.4.1, Jul 2025 | **GPL-3.0-or-later** or commercial | pure Rust since v4 | builds and runs | libimagequant, the pngquant engine. Best palette quality. |
| `quantette` | 0.6.0, May 2026 | MIT OR Apache-2.0 | pure Rust, `no_std` capable | builds and runs | Wu and k-means in Oklab, dithering. RGB only: no alpha in the palette. |
| `exoquant` | 0.2.0, 2016 | MIT | pure Rust | builds and runs | High quality with alpha, slow, unmaintained. |
| `color_quant` | 2.0.0, May 2026 | MIT | pure Rust | builds and runs | NeuQuant, used by `gif`. |
| `zenquant` | 0.1.3 | AGPL or commercial | pure Rust | not tried | |

| Picture | Encoder | Size | Time |
|---|---|---|---|
| screen | ImageMagick PNG | 564 kB | native |
| screen | `png` "High" (close to a browser) | 519 kB | 0.25 s |
| screen | `oxipng` level 2 | 397 kB | 1.7 s |
| screen | `oxipng` level 4 | 395 kB | 3.2 s |
| screen | `oxipng` level 2 with Zopfli, 15 rounds | 391 kB | 36 s |
| photo12 | `png` "High" | 17 818 kB | 4.5 s |
| photo12 | `oxipng` level 2 | 15 663 kB | 6.1 s |

Palette reduction, time only: `quantette` Wu 0.34 s on photo12 and 61 ms on screen, k-means 2.0 s;
`imagequant` speed 4 3.8 s and 0.23 s; `color_quant` 2.9 s and 0.24 s; `exoquant` 1.7 s on screen.
Output quality of the palettes was not scored.

## 5. WebP

| Crate | Version, date | Licence | Kind | wasm32 build | Notes |
|---|---|---|---|---|---|
| `zenwebp` | 0.4.6, Oct 2026 | AGPL-3.0-only OR commercial | pure Rust | builds and runs | Lossy VP8 and lossless VP8L, alpha, animation, method 0 to 6, presets, target size. SIMD128 paths. |
| `image-webp` | 0.2.4, Aug 2025 | MIT OR Apache-2.0 | pure Rust | builds and runs | Decodes everything; encodes **lossless only**, at one fast setting. 109M downloads. |
| `gamut-webp` | 0.3.1, Aug 2026 | MIT OR Apache-2.0 | pure Rust | builds and runs | Lossy and lossless, EXIF and XMP chunks. |
| `webp`, `libwebp-sys`, `webp-animation` | | MIT/Apache, MIT | C bindings to libwebp | not tried | Same C library problem as mozjpeg. |

| Picture | Encoder | Size | PSNR | SSIM distortion | Time |
|---|---|---|---|---|---|
| photo12 | libwebp q75 m4 | 1302 kB | 34.7 | 0.083 | 1.0 s native |
| photo12 | `zenwebp` q75 m4 | 1400 kB | 36.1 | 0.059 | 1.7 s |
| photo12 | `gamut-webp` q75 | 1598 kB | 33.6 | 0.111 | 0.8 s |
| photo12 | libwebp q90 | 3223 kB | 41.3 | 0.017 | native |
| photo12 | `zenwebp` q90 | 3303 kB | 42.7 | 0.013 | 2.1 s |
| screen | libwebp q75 | 456 kB | 36.5 | 0.0062 | native |
| screen | `zenwebp` q75 | 476 kB | 37.2 | 0.0049 | 0.24 s |
| screen | `gamut-webp` q75 | 805 kB | 36.1 | 0.0101 | 0.15 s |
| screen lossless | libwebp | 328 kB | | | 0.4 s native |
| screen lossless | `zenwebp` m4 | 328 kB | | | 0.74 s |
| screen lossless | `gamut-webp` | 398 kB | | | 0.38 s |
| screen lossless | `image-webp` | 560 kB | | | 16 ms |
| photo12 lossless | libwebp / `zenwebp` / `gamut-webp` / `image-webp` | 11 257 / 11 259 / 11 363 / 12 418 kB | | | 4.9 s native / 10.4 / 3.4 / 0.14 s |

`zenwebp` matches libwebp. `gamut-webp` lossy is well behind on screenshots. `image-webp` is a very fast
lossless writer that gives up about 10 to 70 percent in size.

## 6. Reading what browsers cannot

Chrome from version 155 and Safari read JPEG XL; Safari reads HEIC; no browser reads camera raw or TIFF
reliably.

| Job | Crate | Version, date | Licence | Kind | wasm32 | Measured |
|---|---|---|---|---|---|---|
| JPEG XL | `jxl` (jxl-rs) | 0.8.0, Oct 2026 | BSD-3-Clause | pure Rust | builds and runs | photo12 0.49 s, screen 0.15 s, with `simd128`; 0.95 s scalar |
| JPEG XL | `jxl-oxide` | 0.12.6 | MIT/Apache | pure Rust | builds and runs | photo12 1.1 s, screen 0.23 s |
| HEIC | `heic-rs` | 0.1.4, Oct 2026 | MIT OR Apache-2.0 | pure Rust, no unsafe, `no_std` | builds and runs | 12 MP heif-enc file 0.85 s |
| HEIC | `heic` | 0.1.6, May 2026 | AGPL-3.0-only OR commercial | pure Rust | builds and runs | 1.9 s |
| HEIC | `heif-oxide` | 0.1.0, Jul 2026 | MIT OR Apache-2.0 | pure Rust on `rust_h265` | builds, **fails at run time**: uses `std::thread::scope`, which panics in single-threaded wasm | |
| HEIC | `zune-heic` 0.5.0, `heifer` 0.5.0, `heic-decoder` 0.1.1, `gamut-heic` 0.2.2 | 2026 | MIT/Apache (zune adds Zlib) | pure Rust | not tried | |
| HEIC | `libheif-rs` / `libheif-sys` | 3.0.0 | MIT binding; libheif LGPL-3.0, libde265 LGPL-3.0, x265 GPL-2.0 | C bindings | not tried | |
| HEVC | `rust_h265` | 0.4.1, Nov 2026 | MIT OR Apache-2.0 | pure Rust | not tried alone | Passes the 147 JCT-VC conformance streams; threads optional. |
| Raw | `rawloader` | 0.37.2, Aug 2026 | LGPL-2.1 | pure Rust | builds and runs | A7 III ARW to 6048 by 4024 sensor data in 0.13 s; no demosaic |
| Raw | `imagepipe` | 0.5.1 | LGPL-3.0-only | pure Rust | not built | Demosaic, white balance and tone on top of rawloader. |
| Raw | `rawler` (dnglab) | 0.8.0, Aug 2026 | LGPL-2.1 | pure Rust | builds after adding `uuid` with `js`; **fails at run time**: calls `std::time` | Includes a develop pipeline and CR3 support; 665 KB brotli, the largest module here. |
| Raw | `quickraw` 0.1.6 (2023), `libraw-rs` 0.0.4 (2021), `rsraw` 0.1.1 | | LGPL-2.1; LibRaw is LGPL-2.1 or CDDL-1.0 | pure Rust; C++ bindings | not tried | |
| TIFF | `tiff` | 0.11.3 | MIT | pure Rust | builds and runs | 1920 by 1080 in 3 ms |
| JPEG 2000 | `hayro-jpeg2000` | 0.5.0, Nov 2026 | Apache-2.0 OR MIT | pure Rust | builds and runs | 1920 by 1080 in 0.47 s |
| JPEG 2000 | `jpeg2k` 0.10.1, `openjp2` 0.7.0 | | MIT/Apache; BSD-2 | C bindings; Rust port of OpenJPEG | not tried | |
| PSD | `psd` | 0.3.5, Jan 2024 | MIT/Apache | pure Rust | builds and runs | RLE file in 10 ms; **panics on ZIP-compressed layers** (`unimplemented!`) |
| GIF | `gif` | 0.14.2 | MIT/Apache | pure Rust | builds and runs | decode 11 ms; encode screen 0.26 s, 247 kB |
| APNG | `png` | 0.18.1 | MIT/Apache | pure Rust | builds and runs | |

## 7. Metadata and colour

| Crate | Version, date | Licence | Kind | wasm32 | Notes |
|---|---|---|---|---|---|
| `little_exif` | 0.6.23, Jan 2026 | MIT OR Apache-2.0 | pure Rust | builds and runs | Reads and writes EXIF in PNG, JPEG, JXL, TIFF, WebP and HEIF/AVIF without touching the picture. Tested: set Artist in a 2.2 MB JPEG in 8 ms; the picture bytes were unchanged and kamadak-exif and nom-exif read the tag back. No IPTC or XMP. |
| `img-parts` | 0.4.2, Nov 2026 | MIT OR Apache-2.0 | pure Rust | builds and runs | Lifts out and puts back EXIF and ICC chunks in JPEG, PNG and WebP. 14 KB. No parsing. |
| `kamadak-exif` | 0.6.2, Nov 2026 | BSD-2-Clause | pure Rust | builds and runs | Reads EXIF well, writes only a basic TIFF/EXIF block. 17M downloads. |
| `nom-exif` | 3.8.0, Sep 2026 | MIT (licence file) | pure Rust | builds and runs | Reads EXIF from images and video, including HEIC and CR3. Read only. 120 KB. |
| `gamut-metadata` with `gamut-exif`, `gamut-xmp`, `gamut-iptc`, `gamut-icc` | 2.0.0, Oct 2026 | MIT OR Apache-2.0 | pure Rust | not built | The only pure Rust set found that parses and writes EXIF, XMP, IPTC (IIM and over XMP) and ICC together, and handles C2PA explicitly. Stable 1.0 crates, few downloads. Worth trying first for IPTC and XMP. |
| `xmp-writer` | 0.3.3 | MIT/Apache | pure Rust | not built | Writes XMP packets only; from Typst. |
| `xmp_toolkit` | 1.12.1 | MIT/Apache binding of Adobe's C++ toolkit | C++ bindings | not tried | |
| `rexiv2` | 0.10.0, 2023 | GPL-3.0-or-later | bindings to gexiv2, GLib and Exiv2 | not possible in wasm32-unknown-unknown | |
| `exif` | 0.0.1, 2016 | MIT | libexif bindings | dead | |
| `moxcms` | 0.9.2, Nov 2026 | BSD-3-Clause OR Apache-2.0 | pure Rust | builds and runs | ICC v2 and v4, LUT and matrix-shaper transforms. Display P3 to sRGB on 12 MP in 48 ms. 129M downloads (used by `image`). |
| `qcms` | 0.3.0, Jan 2024 | MIT | pure Rust | builds | Firefox's CMS. Smaller (26 KB), fewer profile types. |
| `lcms2` | 6.2.0 | MIT (Little CMS is MIT) | C bindings | not tried | Same C library problem. |
| `kolor` | 0.1.9, 2023 | MIT/Apache | pure Rust | not built | Colour space maths for games, no ICC. |

## 8. Resizing and colour maths

| Crate | Version | Licence | wasm32 | Measured |
|---|---|---|---|---|
| `fast_image_resize` | 6.1.0 | MIT/Apache | builds and runs | 12 MP to half size, Lanczos3, 90 ms. 17 KB at `opt-level "s"` but 256 KB at `"z"`. Has SIMD128 code even in the scalar build. |
| `pic-scale` | 0.7.12 | BSD-3/Apache | builds and runs | Same job in 57 ms, 28 KB. |
| `resize` | 0.8.9 | MIT | not built | Simple, pure Rust. |
| `yuv` | 0.8.20 | BSD-3/Apache | not built | YUV and RGB conversions, from the same author as pic-scale and moxcms. |
| `palette` | 0.7.7 | MIT/Apache | used by quantette | Colour spaces, Oklab, blending. |

## Measured

### Sizes of every module (KB)

Columns: `opt-level "z"` with SIMD128, raw then after `wasm-opt -Oz`, then that file compressed with
brotli 11, zstd 19 and gzip 9; then brotli 11 for `"s"` with SIMD, `3` without SIMD, `3` with SIMD; and
the rebuilt standard library build (below) at `"z"`, where it was made.

| Module | z raw | z after wasm-opt | z brotli | z zstd | z gzip | s brotli | 3 brotli | 3 SIMD brotli | build-std brotli |
|---|---|---|---|---|---|---|---|---|---|
| colorquant | 22 | 19 | 8 | 8 | 9 | 7 | 8 | 8 |  |
| exoquant | 66 | 58 | 20 | 22 | 24 | 21 | 24 | 24 |  |
| fir | 742 | 722 | 256 | 301 | 319 | 17 | 19 | 20 |  |
| gamutavif | 258 | 234 | 96 | 100 | 113 | 97 | 112 | 115 |  |
| gamutwebp | 80 | 71 | 29 | 31 | 34 | 28 | 36 | 37 | 24 |
| gif | 80 | 70 | 28 | 30 | 32 | 27 | 31 | 32 |  |
| heic | 240 | 220 | 75 | 80 | 89 | 75 | 87 | 93 |  |
| heicrs | 177 | 160 | 55 | 59 | 64 | 54 | 67 | 73 | 49 |
| heifoxide | 284 | 253 | 85 | 91 | 102 | 85 | 100 | 107 |  |
| imagequant | 116 | 102 | 42 | 44 | 48 | 42 | 48 | 48 | 31 |
| imagewebp | 176 | 159 | 52 | 56 | 62 | 51 | 58 | 64 |  |
| imgparts | 39 | 34 | 14 | 15 | 16 | 14 | 15 | 15 |  |
| jp2 | 196 | 177 | 50 | 53 | 60 | 53 | 63 | 61 |  |
| jpegenc | 39 | 35 | 14 | 15 | 16 | 14 | 16 | 18 | 10 |
| jxlenc | 871 | 781 | 241 | 255 | 297 | 261 | 351 | 364 | 192 |
| jxloxide | 1011 | 908 | 267 | 302 | 369 | 289 | 342 | 353 |  |
| jxlrs | 1072 | 977 | 274 | 293 | 345 | 289 | 337 | 350 | 237 at "s" |
| kamadak | 126 | 109 | 40 | 43 | 46 | 40 | 42 | 42 |  |
| littleexif | 163 | 142 | 41 | 45 | 51 | 41 | 46 | 46 | 31 |
| moxcms | 151 | 136 | 66 | 69 | 77 | 71 | 72 | 73 |  |
| nomexif | 577 | 507 | 120 | 129 | 158 | 122 | 127 | 127 |  |
| oxipng | 231 | 207 | 77 | 82 | 90 | 80 | 94 | 97 | 59 |
| picscale | 64 | 58 | 28 | 29 | 32 | 28 | 30 | 30 |  |
| png | 168 | 153 | 65 | 68 | 75 | 64 | 66 | 67 |  |
| psd | 54 | 46 | 18 | 20 | 21 | 19 | 23 | 23 |  |
| qcms | 92 | 81 | 30 | 32 | 35 | 31 | 25 | 26 |  |
| quantette | 51 | 44 | 18 | 20 | 21 | 19 | 24 | 23 |  |
| ravif | 747 | 668 | 216 | 233 | 265 | 219 | 253 | 261 | 178 |
| rawler | 3216 | 2936 | 665 | 727 | 896 | 710 | 838 | 858 |  |
| rawloader | 624 | 559 | 132 | 141 | 163 | 140 | 162 | 164 |  |
| tiff | 126 | 111 | 37 | 39 | 44 | 37 | 40 | 41 |  |
| zenjpeg | 304 | 273 | 91 | 97 | 109 | 94 | 123 | 119 | 66 |
| zenwebp | 308 | 281 | 106 | 113 | 125 | 108 | 122 | 131 | 82 |
| zunejxl | 70 | 61 | 22 | 23 | 25 | 21 | 23 | 24 |  |

`wasm-opt -Oz` (binaryen 132) cut the raw file by a median of 10.5 percent (3 to 15 percent), but the
brotli download by only 2 percent. Brotli 11 beat zstd 19 by 5 to 15 percent and gzip 9 by 10 to 25
percent.

`wasm-opt` refused the scalar builds of `fast_image_resize` and `zenjpeg` until SIMD was allowed: both
carry SIMD128 code whatever the target features say, so a browser without SIMD (Safari before 16.4)
would reject them.

### Speed against size

`opt-level "z"` makes the smallest file but slows heavy encoders badly. Times in seconds, one thread:

| Module and job | `"z"` | `"z"` + build-std | `"s"` + build-std | `3` | `3` + build-std | `3` scalar | `"z"` scalar |
|---|---|---|---|---|---|---|---|
| `jxl-encoder`, photo12 d1 e7 | 40.2 s | 20.5 s | 13.3 s | 8.5 s | 10.1 s | 20.3 s | 57.3 s |
| `jxl-encoder`, screen lossless e7 | 17.2 s | 13.2 s | 10.7 s | 6.4 s | 13.3 s | 6.4 s | 16.1 s |
| `ravif`, photo12 q80 speed 6 | 58.6 s | 45.4 s | 28.0 s | 22.3 s | 23.3 s | 26.9 s | 56.9 s |
| `zenwebp`, photo12 q75 | 4.0 s | 3.7 s | 2.2 s | 1.7 s | 1.6 s | 2.6 s | 8.7 s |
| `heic-rs`, 12 MP HEIC | 1.70 s | 1.31 s | 1.07 s | 0.85 s | 0.85 s | 0.95 s | 1.82 s |
| `jxl` (jxl-rs), photo12 | 0.94 s | | 0.50 s | 0.49 s | 0.46 s | 0.95 s | 3.21 s |

Brotli downloads for the same builds:

| Module | `"z"` | `"z"` + build-std | `"s"` + build-std | `3` | `3` + build-std |
|---|---|---|---|---|---|
| `jxl-encoder` | 241 KB | 192 KB | 216 KB | 364 KB | 313 KB |
| `ravif` | 216 KB | 178 KB | 184 KB | 261 KB | 230 KB |
| `zenwebp` | 106 KB | 82 KB | 86 KB | 131 KB | 112 KB |
| `zenjpeg` | 91 KB | 66 KB | 70 KB | 119 KB | 93 KB |
| `heic-rs` | 55 KB | 48 KB | 47 KB | 73 KB | 64 KB |
| `jxl` (jxl-rs) | 274 KB | | 237 KB | 350 KB | 293 KB |
| `oxipng` | 77 KB | 58 KB | 61 KB | 97 KB | 77 KB |

All with SIMD128 unless marked scalar. The scalar columns were run while another job used one core, so
they may be a little slow. `"s"` with the rebuilt standard library is the best middle: within 15
percent of the smallest file and one and a half to two times faster than `"z"`. The rebuilt library
slowed lossless JPEG XL at `opt-level 3` (6.4 to 13.3 s), which leans heavily on memory copies.

The build-std columns used this setting, which needs nightly features. With no nightly toolchain on the
machine, it ran on stable Rust 1.99 with `RUSTC_BOOTSTRAP=1`, which unlocks them; that is not supported
for real builds, and a nightly toolchain should be used instead:

```
[profile.release]
opt-level = "s"   # "z" for the smallest file, 3 for the fastest
lto = "fat"
codegen-units = 1
panic = "abort"
strip = true

RUSTC_BOOTSTRAP=1 \
RUSTFLAGS="-C target-feature=+bulk-memory,+simd128 -Zunstable-options -Cpanic=immediate-abort" \
cargo build --release --target wasm32-unknown-unknown \
  -Z build-std=std,panic_abort -Z build-std-features=optimize_for_size
wasm-opt -Oz --enable-simd --enable-bulk-memory ... in.wasm -o out.wasm
```

Rebuilding std with `optimize_for_size` and making panics abort at once cut brotli downloads by 15 to 30
percent against plain `"z"`: `jxl-encoder` 241 to 192 KB, `ravif` 216 to 178, `zenwebp` 106 to 82,
`zenjpeg` 91 to 66, `oxipng` 77 to 59, `jpeg-encoder` 14 to 10. The cost is that a panic gives no
message at all.

SIMD128 changed `"z"` sizes by under 3 percent and made `opt-level 3` encoders much faster
(`jxl-encoder` 20.3 s scalar to 8.5 s, `ravif` 26.9 to 22.3 s, jxl-rs decode 0.95 to 0.49 s).

### Failures and limits found while running

- `mozjpeg-sys` and `libdeflate-sys` (as oxipng uses by default) do not compile: wasm32-unknown-unknown
  has no `stdlib.h` or `string.h`. oxipng works with `features = ["freestanding"]`.
- `heif-oxide` panics: `std::thread::scope` cannot start a thread.
- `rawler` panics: `std::time` is unsupported. It also needs `uuid` with the `js` feature, which pulls
  in `wasm-bindgen` imports.
- `psd` panics on ZIP-compressed layer data; ImageMagick writes ZIP by default.
- jxl-rs asserts unless the pixel format lists one entry per extra channel; a wrapper bug, fixed.

## Recommendation per format

Build each format as its own module, fetched when the format is picked. Use a nightly toolchain,
`opt-level = "s"`, SIMD128, `-Z build-std=std,panic_abort -Z build-std-features=optimize_for_size`,
`-Cpanic=immediate-abort`, then `wasm-opt -Oz`. Use `opt-level 3` instead only for the AVIF encoder if its
time matters more than 50 KB. Keep a debug build with panic messages for development.

- **JPEG XL out:** `jxl-encoder` with `default-features = false, features = ["std"]` (the Butteraugli
  loop only matters at effort 8 and up). Effort 3 by default (1.6 s for 12 MP at `opt-level 3`, about
  2.5 s at `"s"`, file within 2 percent of effort 7), effort 7 as "smallest". 216 KB. Needs the AGPL or
  the US$1 licence settled first. If that is refused: `zune-jpegxl` for lossless only (22 KB, 0.5 s),
  and lossy JPEG XL waits.
- **AVIF out:** `ravif` with `default-features = false`, speed 6, 10-bit, quality 70 to 80. 184 KB at
  `"s"` (28 s for 12 MP) or 230 KB at `opt-level 3` (22 to 23 s). Run it in a worker with a progress bar
  and plan threads (estimated 4 to 7 s on eight). Do not offer AVIF for screenshots.
- **JPEG out:** `zenjpeg` progressive (70 KB, 0.5 s) if the Imazen licence is taken; otherwise
  `jpeg-encoder` progressive with optimised tables (10 KB, 0.2 s), which still beats the browser by
  about 7 percent.
- **PNG out:** `oxipng` level 2 with `freestanding` (61 KB, 1.7 s for a screenshot, 6 s for 12 MP),
  Zopfli only as an "as small as possible" switch. For lossy PNG, `quantette` (18 KB, MIT) before
  oxipng; `imagequant` gives better palettes with alpha but is GPL-3.0.
- **WebP out:** `zenwebp` if licensed (86 KB, 2.2 s lossy for 12 MP). Otherwise the browser's own lossy
  WebP, and `gamut-webp` (24 KB, nearer libwebp) or `image-webp` (52 KB, much faster) for lossless.
- **JPEG XL in:** `jxl` with the `simd128` feature (237 KB, 0.5 s for 12 MP), only when the browser
  cannot decode it; test with a tiny image first.
- **HEIC in:** `heic-rs` with `default-features = false, features = ["std"]` (47 KB, 1.1 s for 12 MP).
  iPhone files with grids, alpha, depth or gain maps were not tested here and should be next. Settle the
  patent question first (below).
- **Raw in:** `rawloader` gives sensor data only (132 KB). A full developer means `imagepipe` on top, or
  patching `rawler`'s use of `std::time`. Both are LGPL.
- **TIFF:** `tiff` (37 KB). **JPEG 2000:** `hayro-jpeg2000` (50 KB). **PSD:** `psd` reads the flattened
  picture of RLE files only.
- **Metadata:** `little_exif` for EXIF (32 KB); try `gamut-metadata` for XMP and IPTC. Carry chunks over
  unchanged with `img-parts` (14 KB) when re-encoding a JPEG, PNG or WebP.
- **Colour:** `moxcms` (66 KB) to bring P3 and other ICC profiles to sRGB, or to keep them.
- **Resize:** `pic-scale` (28 KB, 57 ms for 12 MP to half), or `fast_image_resize` built at `"s"`.

## Licences and patents that are a problem

- **AGPL-3.0 or paid (Imazen):** `jxl-encoder`, `zenjpeg`, `zenwebp`, `heic`, `zenavif`, `zenpng`,
  `zenquant`, `zenraw`, `rav1d-safe`. AGPL asks that anyone who uses the program over a network can get
  its source. If imgQuire's source is public under an AGPL-compatible licence this can be met, but it
  makes imgQuire itself AGPL. The other path is Imazen's commercial licence (US$1 for very small
  companies).
- **GPL-3.0-or-later:** `imagequant` (also sold commercially), `jpegxl-rs` and `jpegxl-sys` bindings,
  `rexiv2`.
- **LGPL:** `rawloader`, `rawler`, `quickraw` (2.1); `imagepipe` (3.0); libheif and libde265 (3.0);
  LibRaw (2.1 or CDDL). Statically linked into a wasm module, the LGPL asks that users can relink with a
  changed library; with the module's source public that is simple to meet.
- **MPL-2.0:** `avif-parse` (file-level copyleft; fine to use unchanged).
- **IJG:** `jpeg-encoder` and `mozjpeg` carry the IJG licence, which asks for a line of credit to the
  Independent JPEG Group in the documentation.
- **HEVC patents:** HEIC pictures are HEVC. HEVC is covered by patents pooled by Access Advance and by
  Via LA (once MPEG LA), and others license separately. A pure Rust decoder solves copyright, not
  patents. This is why Chrome and Firefox do not decode HEIC in software. Shipping a free HEVC decoder in
  a web page is a legal question, not a technical one; ask before shipping, or decode HEIC only where
  the system already holds a licence (Safari reads HEIC).
- AV1, JPEG XL, WebP, PNG and JPEG are royalty free.

## Could not build or verify

- `mozjpeg`, `libwebp` bindings, `libavif`, SVT-AV1, `lcms2`, `libheif-rs`, LibRaw, `xmp_toolkit`,
  `jpegxl-rs`: all need a C or C++ standard library that wasm32-unknown-unknown lacks. Emscripten could
  build them, outside this plan. The later C trial built mozjpeg, libwebp, libavif, libaom, SVT-AV1,
  libjxl and jpegli this way, directly in C without the Rust bindings.
- `heif-oxide` and `rawler` build but panic at run time (threads, clock).
- `gamut-metadata`, `gamut-jpeg`, `zune-heic`, `heifer`, `heic-decoder`, `zenavif`, `rav1d`,
  `oxideav-*`, `imagepipe`, `resize`, `yuv` were found but not built.
- Threaded WebAssembly was not measured for any crate.
- Palette quality of the quantisers was not scored. JPEG and AVIF quality were measured with PSNR and
  SSIM only; Butteraugli or SSIMULACRA2 would be better judges.
- A real iPhone HEIC (grid tiles, 10-bit, gain map) and real phone photos were not tested.
- Browser timings: everything ran in Node 22 (V8), the same engine as Chrome, but not in a page.

## C encoders built with Emscripten

13 November 2026, later the same day. The question was whether the reference encoders in C and C++
would do better than the Rust crates once built to WebAssembly, and how small they could be made.
Every library here is BSD or IJG. Nothing here is in the site yet.

### How they were built and measured

- Toolchain: Emscripten's own SDK (emsdk, `latest`), cloned into the scratch folder and activated in one
  shell only. emcc 7.0.0 (777e6e5), clang 24.0.0git, binaryen `wasm-opt` version 133. No sudo, no system
  packages, no shell profile changed. wasi-sdk was not needed.
- Sources, shallow clones of each project's main branch: libjxl 9e02071 (11 Nov 2026, a 0.13 snapshot),
  jpegli 031a007 (1 Jun 2026; jpegli now lives in its own repository, google/jpegli, not in libjxl),
  libaom bcc98e0 (13 Nov 2026), libavif 90d3b66 (6 Nov 2026), libwebp f9c049d (13 Nov 2026), mozjpeg
  0826579 (23 Jun 2025), SVT-AV1 e3d6340 (v4.3.0, 1 Nov 2026).
- Each encoder is its own module with the same calling shape as the Rust trial: `q_alloc`,
  `encode(ptr, len, w, h, q, speed)` from RGBA8 to file bytes, `q_out_ptr`, `q_info`, and `q_opt(key,
  value)` for extra options (lossless, threads, screen content tools, 10-bit). The wrappers are 20 to 40
  lines of C each.
- Single-threaded modules are linked with `-sSTANDALONE_WASM --no-entry -sFILESYSTEM=0
  -sMALLOC=emmalloc -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_FUNCTIONS=` (the five entry points only). They
  need no JavaScript glue; the page supplies one empty import (`emscripten_notify_memory_growth`) and, for
  some, the WASI write calls that only an error message would use.
- Threaded modules use `-pthread -sPTHREAD_POOL_SIZE=4` and Emscripten's glue file, which starts one Web
  Worker per thread from the same `.wasm`. The glue is 21 to 27 KB, 6 to 7 KB with brotli.
- Times: Node 22.23.5 (V8, as Chrome), the same harness method as the Rust trial: only the `encode` call
  is timed, after instantiation. Every run was pinned to four cores (8 to 11) at low priority with other
  jobs on the machine, never more than four threads. Each setting was run twice and the faster time kept;
  the two runs differed by up to 15 percent, so treat small differences as noise.
- Quality: ImageMagick `compare`, PSNR in dB and SSIM distortion, against the same two test pictures, as
  before. "Memory" is the module's linear memory at the end of the encode, which is its peak.
- Sizes: "raw" is the linker's output before any `wasm-opt`; "after wasm-opt" is `wasm-opt -Oz
  --converge --strip-debug --strip-producers` of emcc's output; "brotli" is that file at level 11 with a
  24-bit window (the largest a browser accepts for `Content-Encoding: br`). Module sizes in KB of 1024
  bytes, picture sizes in kB of 1000 bytes, as above.

Variant names used in the tables:

| Variant | Compile and link flags |
|---|---|
| O3 | `-O3 -msimd128 -DNDEBUG`, no LTO |
| O3 LTO | `-O3 -msimd128 -flto -DNDEBUG` |
| Os | `-Os -msimd128 -flto -DNDEBUG` |
| Oz | `-Oz -msimd128 -flto -DNDEBUG` |
| O3 scalar | `-O3 -flto -DNDEBUG`, no SIMD |
| MT | O3 LTO plus `-pthread`, 4 threads in the pool |
| MT Os | Os plus `-pthread` |

All of them strip what each library's own build switches allow: no decoder, tools, tests or examples;
libaom with `CONFIG_AV1_DECODER=0 CONFIG_AV1_HIGHBITDEPTH=0 CONFIG_DENOISE=0 CONFIG_WEBM_IO=0
CONFIG_LIBYUV=0 CONFIG_RUNTIME_CPU_DETECT=0`; libavif with no decoder codec, libyuv, sharpyuv, libxml2,
JPEG or PNG; libjxl with `JPEGXL_ENABLE_TRANSCODE_JPEG=OFF JPEGXL_ENABLE_BOXES=OFF`, skcms instead of
lcms2, and Highway building its WebAssembly target only (`HWY_COMPILE_ONLY_STATIC`); mozjpeg with no
arithmetic coding, TurboJPEG or SIMD assembly.

### JPEG XL: libjxl

| Variant | Raw | After wasm-opt | Brotli | photo12 d1 e3 | photo12 d1 e7 | photo12 d2 e5 | photo12 lossless e3 | screen d1 e7 | screen lossless e7 |
|---|---|---|---|---|---|---|---|---|---|
| O3 | 3201 | 2350 | 655 KB | | 4.5 s | | | | |
| O3 LTO | 3318 | 2583 | 684 KB | 0.50 s | 4.0 s | 2.0 s | 1.5 s | 0.84 s | 0.58 s |
| Os | 2549 | 1730 | 556 KB | 0.54 s | 6.0 s | | | | 0.74 s |
| Oz | 2484 | 1578 | 519 KB | | 7.6 s | | | | 0.79 s |
| O3 scalar | 3291 | 2445 | 677 KB | | 21.0 s | | | | 0.65 s |
| MT, 4 threads | 3351 | 2652 | 691 KB + 7 KB glue | 0.33 s | 1.5 s | 0.80 s | 0.54 s | 0.48 s | 0.29 s |
| MT, 1 thread | | | | | 4.0 s | | | | |
| MT Os, 4 threads | 2583 | 1798 | 552 KB + 7 KB glue | | 2.3 s | | | | 0.31 s |

Output, the same for every variant:

| Picture | Setting | Size | PSNR | SSIM distortion | Memory |
|---|---|---|---|---|---|
| photo12 | d1 e3 | 2365 kB | 38.3 | 0.036 | 353 MB |
| photo12 | d1 e7 | 2214 kB | 37.8 | 0.043 | 467 MB |
| photo12 | d2 e5 | 714 kB | 33.6 | 0.131 | 378 MB |
| photo12 | lossless e1 | 13 548 kB in 0.28 s | | | 153 MB |
| photo12 | lossless e3 | 11 705 kB | | | 332 MB |
| screen | d1 e7 | 659 kB | 41.9 | 0.0035 | 165 MB |
| screen | d2 e5 | 514 kB | 37.1 | 0.0104 | 142 MB |
| screen | lossless e1 | 1030 kB in 39 ms | | | |
| screen | lossless e3 | 1188 kB in 0.29 s | | | |
| screen | lossless e7 | 265 kB | | | 98 MB |

The files are the size native cjxl 0.12 made in the Rust trial (2217 kB at d1 e7), but PSNR is 1.2 dB
lower and SSIM distortion 0.043 against 0.032 for the native file, measured again today on the same
machine. The difference is most likely the 0.13 snapshot's tuning, not the WebAssembly build, since the
lossless files match native cjxl to the byte. A release tag should be built and compared before
shipping. Effort 1 lossless is libjxl's fast lossless path, the code `zune-jpegxl` ports, and gives the
same 13 548 kB.

### AVIF: libaom with libavif

All-intra, which libavif picks for a still picture. Quality is libavif's 0 to 100; speed is libaom's.
"Screen tools" is `tune-content=screen`.

| Variant | Raw | After wasm-opt | Brotli | photo12 q80 s6 | photo12 q60 s8 | screen q80 s6 |
|---|---|---|---|---|---|---|
| O3, 8-bit only | 4071 | 3909 | 903 KB | 3.9 s | 0.65 s | 0.86 s |
| O3 with 10 and 12 bit | 5799 | 5526 | 1004 KB | 4.1 s (10-bit 4.5 s) | | |
| Os | 2922 | 2629 | 780 KB | 4.3 s | 0.74 s | 0.95 s |
| Os with 10 and 12 bit | 3505 | 2987 | 829 KB | | | |
| Oz | 2429 | 2120 | 724 KB | 4.8 s | | |
| O3 scalar | 3129 | 2710 | 802 KB | 7.9 s | | 1.9 s |
| MT, 4 threads | 4338 | 4241 | 942 KB + 7 KB glue | 1.5 s | 0.44 s | 0.46 s |
| MT, 1 thread | | | | 3.8 s | | |
| MT Os, 4 threads | 2963 | 2685 | 790 KB + 7 KB glue | 1.6 s | | 0.47 s |

Speed presets on the O3 build, one thread, and output:

| Picture | Setting | Size | PSNR | SSIM distortion | Time |
|---|---|---|---|---|---|
| photo12 | q80 s6 | 2777 kB | 40.1 | 0.024 | 3.9 s |
| photo12 | q80 s7 | 2761 kB | 39.8 | 0.026 | 2.2 s |
| photo12 | q80 s8 | 2780 kB | 39.8 | 0.026 | 0.88 s (0.51 s on 4 threads) |
| photo12 | q80 s9 | 2761 kB | 39.9 | 0.026 | 0.77 s |
| photo12 | q60 s8 | 1153 kB | 34.6 | 0.093 | 0.65 s |
| photo12 | q80 s6, 10-bit | 2948 kB | 41.0 | 0.020 | 4.5 s |
| screen | q80 s6, with or without screen tools | 152 kB | 49.3 | 0.0010 | 0.86 s |
| screen | q60 s8, screen tools | 118 kB | 44.3 | 0.0073 | 0.26 s |
| screen | q80 s9, screen tools | 144 kB | 48.0 | 0.0020 | 0.21 s |

Peak memory was 297 MB for the photo and 71 MB for the screenshot. Turning screen tools on changed
nothing here: in all-intra mode libaom detects screen content by itself. The WebAssembly build makes the
same file as native avifenc in the Rust trial (2780 kB, 40.0 dB at q80 s6) in about the same time on one
thread (3.9 s against 3.7 s). Speed 8 gives nearly the same file in a quarter of the time of speed 6.
The SSE intrinsics translated to SIMD128 (libaom's new `ENABLE_WASM_X86_INTRINSICS` switch) made it
twice as fast and cost about 100 KB of brotli download.

**SVT-AV1** built for WebAssembly with `COMPILE_C_ONLY=ON` and linked into libavif. It only runs threaded:
it starts its own threads even when asked for one. 2860 KB raw, 2574 KB after wasm-opt, 619 KB brotli
plus 7 KB glue.

| Picture | Setting | Size | PSNR | SSIM distortion | 1 thread | 4 threads |
|---|---|---|---|---|---|---|
| photo12 | q80 preset 8 | 2724 kB | 40.6 | 0.020 | 2.2 s | 1.4 s |
| photo12 | q80 preset 10 | 2724 kB | 40.6 | 0.021 | 1.7 s | |
| photo12 | q60 preset 10 | 1081 kB | 34.8 | 0.086 | | 0.96 s |
| screen | q80 preset 8 | 693 kB | 43.1 | 0.0020 | | 0.57 s |

On the photo SVT-AV1 makes a slightly smaller and closer file than libaom at speed 8, but takes longer
(2.2 s against 0.88 s on one thread), uses up to 1 GB of process memory, needs a pool of eight workers, and makes a screenshot four and a half times the
size of libaom's.

### JPEG: jpegli and mozjpeg

Both through the libjpeg API, progressive, 4:2:0.

| Encoder, variant | Raw | After wasm-opt | Brotli | photo12 q85 |
|---|---|---|---|---|
| jpegli O3 | 166 | 135 | 47 KB | 0.17 s |
| jpegli Os | 137 | 110 | 43 KB | 0.19 s |
| jpegli Oz | 126 | 93 | 34 KB | 0.32 s |
| jpegli O3 scalar | 171 | 143 | 50 KB | 0.41 s |
| mozjpeg O3 | 376 | 327 | 58 KB | 1.26 s |
| mozjpeg Os | 283 | 248 | 46 KB | 1.36 s |
| mozjpeg Os, libc output removed | 279 | 224 | 36 KB | 1.36 s |
| mozjpeg Oz | 270 | 238 | 43 KB | 1.44 s |
| mozjpeg O3 scalar | 336 | 296 | 52 KB | 1.34 s |

| Picture | Encoder | Size | PSNR | SSIM distortion | Time (Os) |
|---|---|---|---|---|---|
| photo12 | jpegli q75 | 620 kB | 33.3 | 0.144 | 0.15 s |
| photo12 | jpegli q85 | 1381 kB | 34.9 | 0.092 | 0.19 s |
| photo12 | mozjpeg q75 | 769 kB | 33.5 | 0.136 | 0.83 s |
| photo12 | mozjpeg q85 | 1443 kB | 34.5 | 0.103 | 1.36 s |
| photo12 | mozjpeg q85, standard tables | 1742 kB | 34.7 | 0.095 | 1.58 s |
| screen | jpegli q85 | 618 kB | 35.6 | 0.0089 | 44 ms |
| screen | jpegli q95 | 845 kB | 43.5 | 0.0022 | 44 ms |
| screen | mozjpeg q85 | 554 kB | 26.9 | 0.0157 | 0.37 s |
| screen | mozjpeg q85, standard tables | 621 kB | 34.5 | 0.0108 | 0.41 s |
| screen | mozjpeg q95 | 789 kB | 38.3 | 0.0049 | 0.50 s |

Peak memory about 100 MB for jpegli and 130 MB for mozjpeg on the photo. jpegli is seven times faster
than mozjpeg and better on both pictures. mozjpeg's default tables and trellis smear the screenshot's
hard edges (26.9 dB at q85). jpegli matches `zenjpeg` from the Rust trial (1364 kB, 34.9 dB, 0.4 s).

### WebP: libwebp

SSE2 and SSE4.1 paths through Emscripten's translation headers (libwebp's CMake turns them on for
Emscripten when `-msimd128` is given). Lossless at libwebp's default effort (quality 75, method 4,
lossless preset 6). The Oz build also sets `WEBP_REDUCE_SIZE` and `WEBP_DISABLE_STATS`, which changed no
output byte here.

| Variant | Raw | After wasm-opt | Brotli | photo12 q75 | photo12 q90 | screen q75 | screen lossless | photo12 lossless |
|---|---|---|---|---|---|---|---|---|
| O3 | 530 | 515 | 126 KB | 1.03 s | | | | |
| O3 LTO | 386 | 377 | 106 KB | 1.05 s | 1.30 s | 0.16 s | 0.62 s | 7.1 s |
| Os | 245 | 233 | 82 KB | 1.03 s | 1.32 s | 0.17 s | 0.68 s | 8.0 s |
| Oz with REDUCE_SIZE | 190 | 170 | 67 KB | 1.07 s | | 0.17 s | | |
| Oz | 198 | 178 | 70 KB | 1.13 s | | | 0.68 s | |
| Oz scalar, REDUCE_SIZE | 145 | 126 | 57 KB | 2.11 s | | | | |
| O3 scalar | 323 | 289 | 92 KB | 1.78 s | | | 0.72 s | |
| MT (`thread_level` 1) | 417 | 398 | 113 KB + 6 KB glue | 0.94 s | | | 0.62 s | |

| Picture | Setting | Size | PSNR | SSIM distortion | Memory |
|---|---|---|---|---|---|
| photo12 | q75 m4 | 1302 kB | 34.7 | 0.083 | 93 MB |
| photo12 | q90 m4 | 3223 kB | 41.3 | 0.017 | 132 MB |
| screen | q75 m4 | 456 kB | 36.5 | 0.0062 | 22 MB |
| screen | lossless | 328 kB | | | 65 MB |
| screen | lossless, quality 100 method 6 | 317 kB in 4.9 s | | | |
| photo12 | lossless | 11 257 kB | | | 407 MB |

Every file is the same size as native libwebp 1.6.0 made in the Rust trial, and lossy WebP runs as fast
as native did (1.0 s). libwebp's own threading only splits off small jobs and gained little. SIMD128
nearly halved the lossy time and cost 10 to 14 KB.

### What each size trick saved

Tried in order on libwebp, each step added to the one before. Brotli of the `.wasm`; the first steps
also need Emscripten's small glue file (6 to 8 KB, 2 to 3 KB with brotli). Times for photo12 q75.

| Step | .wasm | Brotli | Saved by this step | photo12 q75 |
|---|---|---|---|---|
| 1. Plain `-O3 -msimd128`, default emcc output with glue | 518 KB | 127 KB | | 1.03 s |
| 2. `-Os` instead | 335 KB | 103 KB | 24 KB | 1.03 s |
| 3. `-Oz` instead | 261 KB | 85 KB | 18 KB | 1.13 s |
| 4. `-flto` | 183 KB | 71 KB | 14 KB | 1.13 s |
| 5. `-ffunction-sections -fdata-sections -Wl,--gc-sections` | 183 KB | 71 KB | 0 (wasm-ld already drops unused functions) | |
| 6. Library switches: `WEBP_REDUCE_SIZE`, `WEBP_DISABLE_STATS`, no near-lossless | 175 KB | 69 KB | 2 KB | 1.07 s |
| 7. `STANDALONE_WASM`, `FILESYSTEM=0`, emmalloc, five exports, no glue | 171 KB | 67 KB | 2 KB and the glue file (emmalloc alone 1.5 KB) | 1.07 s |
| 8. `wasm-opt -Oz --converge` again | 170 KB | 67 KB | under 0.5 KB (emcc already ran `wasm-opt -Oz`) | |
| 9. Other passes: `--gufa`, `--closed-world --gufa-optimizing`, `-tnh`, `--monomorphize`, `--dae-optimizing`, `--inlining-optimizing`, `--vacuum` | 170 KB | 67 KB | 0 to 0.3 KB; `--monomorphize` grew it | |
| 10. `wasm-metadce` on the exports | 170 KB | 67 KB | nothing; the brotli file grew 0.3 KB | |
| 11. Stubs for `printf`, `fputs`, `getenv` | | | nothing left to remove in libwebp after step 1's `-DNDEBUG` | |
| 12. SIMD128 off | 126 KB | 57 KB | 10 KB, but twice as slow | 2.11 s |

Lessons from the ladder and from the other libraries:

- `-DNDEBUG` matters and is easy to lose: these builds clear CMake's release flags to choose the `-O`
  level, which also drops `-DNDEBUG`. Without it libwebp's download was 8 KB larger at `-O3` and 12 KB
  larger at step 6, from the asserts and the `fprintf` they pull in.
- `-Os` against `-O3`: 10 to 25 percent smaller, with no loss in speed for libwebp, under 10
  percent for jpegli and libaom, and 50 percent slower for libjxl at effort 7 (4.0 to 6.0 s). `-Oz` saves
  a further 7 to 20 percent of size and costs 10 to 25 percent of speed, and nearly doubles jpegli's time.
- Per-file mixes: libwebp with its `dsp/` files at `-O3` and the rest at `-Oz`, all with LTO, was 75 KB
  linked at `-Oz` and 83 KB at `-O3` or `-Os`, and no faster than a plain `-Os` build (1.05 to 1.13 s for
  photo12, 0.64 to 0.71 s for screen lossless). LTO and `wasm-opt` treat the module as a whole, so the
  per-file `-O` level is mostly lost. Not worth the build complexity.
- `-fno-exceptions -fno-rtti`: libjxl and jpegli already build that way and Emscripten does not catch
  exceptions by default, so it saved nothing more.
- High bit depth: libaom without 10 and 12 bit saved 50 KB (Os) to 100 KB (O3) of brotli. Keep it off
  unless 10-bit AVIF is offered; then build a second module.
- Replacing libc's text output: wasm-ld's `--wrap=fprintf,vfprintf,printf,fputs,puts,fputc,fwrite,fflush,getenv`
  pointing at empty functions cut mozjpeg from 46 to 36 KB (the float formatting in `vfprintf` goes),
  with the output identical to the byte. It saved 3 KB on libjxl and 1 KB on libaom. Defining the
  functions directly fails, because Emscripten's own libc defines them in the same objects.
- `setjmp`: libaom uses `setjmp` for errors. With the default JavaScript `setjmp` the standalone module
  needs `invoke_*` imports; `-sSUPPORT_LONGJMP=wasm` at compile and link uses WebAssembly exception
  handling instead, which every current browser supports.

**Black magic, tried:**

| Trick | Result |
|---|---|
| Split rarely used code into a second module (`wasm-split`, guided by a profile of typical encodes) | Worked. libwebp: 44 KB for lossy plus 40 KB loaded only for lossless (82 KB whole). libjxl Os: 412 KB plus 161 KB (555 KB whole); efforts 1 to 7 and distances from lossless to 3 never touched the second part, and an unprofiled setting (d1.5 e4) ran in the first part alone. libaom Os: 595 KB plus 207 KB (779 KB whole); the 865 KB of tables stay in the first part. Any path missing from the profile calls a placeholder, so the page needs a loader that fetches the second part and fills the table when that happens (Emscripten's `SPLIT_MODULE` writes one), and the profile must be rerun on every rebuild. |
| One module for two formats that share code: libjxl and jpegli | Small gain. 581 KB together against 556 + 43 = 599 KB apart. They share only Highway and libc++; jpegli has its own copies of the rest in its own namespace. |
| Brotli across two modules concatenated (what a shared dictionary would give) | 1 to 3 percent: libjxl and jpegli 780 to 764 KB, libwebp and mozjpeg 142 to 138 KB, libaom and libjxl 1518 to 1502 KB. A browser can only use this through Compression Dictionary Transport, which needs server support; not worth it here. |
| `wasm-opt --gufa`, `--closed-world`, `-tnh`, `--monomorphize` | Under 1 percent (see the ladder). On a build with asserts still in, `--closed-world --gufa-optimizing` saved 1 percent. |
| `wasm-metadce` | Nothing: the exports are already only the five entry points. |
| Stubs for libc output | 10 KB on mozjpeg, little elsewhere (above). |
| Transport | Brotli 11 with the largest browser window (24 bits) gave the same bytes as the default window for files this size. Gzip 9 was 15 to 30 percent larger. Chrome and Firefox now accept `Content-Encoding: zstd`, but the Rust trial found zstd 19 5 to 15 percent larger than brotli, and Cloudflare Pages sends brotli. Nothing a browser decodes natively beat brotli 11. |

### Rust against C, per format

| Format | Choice | Licence | Download | 12 MP photo | Output |
|---|---|---|---|---|---|
| JPEG XL lossy | `jxl-encoder` (Rust, "s") | AGPL or paid | 216 KB | 2.5 s e3, 13 s e7 | d1 e7 2418 kB, 39.6 dB |
| | libjxl Os | BSD-3 | 556 KB (412 KB split) | 0.54 s e3, 6.0 s e7; MT Os 2.3 s e7 | d1 e7 2214 kB, 37.8 dB |
| JPEG XL lossless | `zune-jpegxl` | MIT/Apache/Zlib | 22 KB | 0.53 s | 13 548 kB; screen 1030 kB |
| | libjxl O3 LTO | BSD-3 | 684 KB | 0.28 s e1, 1.5 s e3 | 11 705 kB at e3; screen 265 kB at e7 |
| AVIF | `ravif` (Rust, "s") | BSD | 184 KB | 28 s at speed 6 | q80 1553 kB 36.7 dB; screen 508 kB 37.2 dB |
| | libaom + libavif Os | BSD-2 + AOM patent licence | 780 KB | 4.3 s s6, 0.74 s s8; MT Os 1.6 s s6 | q80 2777 kB 40.1 dB, q60 1153 kB 34.6 dB; screen 152 kB 49.3 dB |
| JPEG | `zenjpeg` | AGPL or paid | 70 KB | 0.4 s | q85 1364 kB 34.9 dB |
| | `jpeg-encoder` | MIT/Apache and IJG | 10 KB | 0.2 s | q85 2288 kB 35.1 dB |
| | jpegli Os / Oz | BSD-3 | 43 / 34 KB | 0.19 / 0.32 s | q85 1381 kB 34.9 dB |
| WebP lossy | `zenwebp` | AGPL or paid | 86 KB | 2.2 s | q75 1400 kB 36.1 dB |
| | libwebp Oz, REDUCE_SIZE | BSD-3 | 67 KB | 1.07 s | q75 1302 kB 34.7 dB, as native |
| WebP lossless | `image-webp` | MIT/Apache | 52 KB | 0.14 s | screen 560 kB, photo 12 418 kB |
| | libwebp Oz, REDUCE_SIZE | BSD-3 | 67 KB (same module) | 8 s | screen 328 kB in 0.68 s, photo 11 257 kB |

Summary of the comparison:

- **JPEG XL:** libjxl is two and a half times the download of `jxl-encoder` but two to three times
  faster, scales on threads, and is BSD. It is the only permissive lossy JPEG XL encoder found.
- **AVIF:** libaom is four times the download of `ravif` and five to thirty times faster. On the photo
  the two are close along the size and quality curve (`ravif` q80 1553 kB at 36.7 dB, libaom q60 1153 kB
  at 34.6 dB); on the screenshot libaom is far ahead.
- **JPEG:** jpegli is the best JPEG encoder tried, at 34 to 43 KB, and permissive.
- **WebP:** libwebp is the reference itself, smaller than `zenwebp`, twice as fast, and permissive.
  Lossless is 40 percent smaller than `image-webp`.

### Revised recommendation per format, with C encoders

Under the rule: permissive licences only (BSD, MIT, Apache, IJG, Zlib). Build each as its own module
fetched when the format is picked. Use `-Os` or `-Oz` with `-flto -msimd128 -DNDEBUG`, standalone with
emmalloc and no filesystem, and the library's own switches to drop the decoder and tools.

- **JPEG XL out:** libjxl. Default: the Os build, single-threaded, 556 KB, effort 3 (0.54 s for 12 MP),
  effort 7 as "smallest" (6 s). Best: the MT Os build, 552 KB plus 7 KB glue, effort 7 in 2.3 s on four
  threads. Splitting with `wasm-split` would bring the first download to about 412 KB. Build a release
  tag and check the PSNR gap against cjxl before shipping. Lossless only, very small: `zune-jpegxl`
  (22 KB) stays a good fallback, and gives the same file as libjxl at effort 1.
- **AVIF out:** libaom with libavif, 8-bit. Default: MT Os, 790 KB plus 7 KB glue, speed 8 (about 0.5 s
  for 12 MP on four threads), speed 6 as "smallest" (1.6 s). Without threads: the Os build, 780 KB, 4.3 s
  at speed 6 and 0.74 s at speed 8. Screenshots encode well (152 kB at 49 dB). A 10-bit option means a
  second module (829 KB). AVIF has no small option: `ravif` (184 KB) only if the download matters more
  than 28 seconds. SVT-AV1 is not worth it here (memory, threads only, poor on screenshots).
- **JPEG out:** jpegli. Default: the Oz build, 34 KB, 0.32 s for 12 MP. Best: Os, 43 KB, 0.19 s.
  mozjpeg is not needed. `jpeg-encoder` (10 KB) remains the tiny option if 34 KB is too much.
- **WebP out:** libwebp, lossy and lossless in one module. Default: Oz with `WEBP_REDUCE_SIZE` and
  `WEBP_DISABLE_STATS`, 67 KB, 1.1 s lossy for 12 MP, 0.7 s lossless for a screenshot. Best for speed:
  Os, 82 KB, slightly faster on lossless. This replaces both `zenwebp` and `image-webp`.
- **PNG, reading formats, metadata, colour, resize:** unchanged from "Recommendation per format" above.
- Use threads only for JPEG XL effort 5 and up and for AVIF; they need cross-origin isolation, which the
  pages have, and the glue file. JPEG and WebP are fast enough on one thread.

### Licences and patent notes for the C libraries

- **libjxl:** BSD-3-Clause ("Copyright (c) the JPEG XL Project Authors"), plus a PATENTS file: Google's
  "Additional IP Rights Grant (Patents)", a perpetual, no-charge, royalty-free patent licence for this
  implementation of JPEG XL, which ends for anyone who sues claiming the implementation infringes a
  patent. Bundled: Highway (Apache-2.0, also offered under BSD-3-Clause), brotli (MIT), skcms (BSD-3-Clause).
- **jpegli:** BSD-3-Clause and the same Google PATENTS grant as libjxl. Bundled Highway as above.
- **libaom:** BSD-2-Clause ("Copyright (c) 2016, Alliance for Open Media"), plus the Alliance for Open
  Media Patent License 1.0: a royalty-free patent licence from AOM members for any implementation, which
  ends for anyone who brings a patent suit over an implementation of AV1. Bundled and used: fastfeat
  (BSD-3-Clause).
- **libavif:** BSD-2-Clause ("Copyright 2019 Joe Drago"). Bundles parts of libyuv under a BSD-style
  licence (the LibYuv Project Authors).
- **SVT-AV1:** BSD-3-Clause-Clear (the Clear BSD License, which states that no patent rights are granted
  by the copyright licence) plus the Alliance for Open Media Patent License 1.0.
- **libwebp (with sharpyuv):** BSD-3-Clause ("Copyright (c) 2010, Google Inc."), plus Google's
  "Additional IP Rights Grant (Patents)" for the WebM codecs, with the same termination clause.
- **mozjpeg:** the IJG licence for the libjpeg library code, the Modified (3-clause) BSD licence for the
  TurboJPEG API and build system, and zlib for the SIMD code (not built here). The IJG licence asks for a
  line in the documentation: "this software is based in part on the work of the Independent JPEG Group".
- **Emscripten's runtime linked into every module:** Emscripten (MIT or University of Illinois/NCSA),
  musl libc (MIT), emmalloc (MIT), libc++ and compiler-rt (Apache-2.0 with LLVM exception).
- None is LGPL. AV1, JPEG XL and WebP are royalty free; the patent grants above end only for someone
  who sues. libheif and libde265 (LGPL-3.0) were not built.

### What failed and what was not tried

- Nothing failed to build in the end. Problems met and solved: libaom's `setjmp` needed
  `-sSUPPORT_LONGJMP=wasm`; C++ libraries needed linking with libc++; jpegli is no longer in the libjxl
  repository and was cloned from google/jpegli; mozjpeg's static library switch is `BUILD_SHARED_LIBS=OFF`;
  jpegli's API header is C++, so its wrapper is C++.
- SVT-AV1 built (C only, no assembly) and runs, but only with threads; numbers above.
- libjxl's lossy quality question (PSNR 1.2 dB under cjxl 0.12 at the same size) was not resolved.
- Threaded builds were timed in Node with `worker_threads`, not in a browser page.
- libheif with libde265 for HEIC reading (LGPL) was not tried; `heic-rs` stays the HEIC reader to test.
- The plain glue builds of the ladder's first four steps were sized but timed through the equivalent
  standalone builds (same flags), since their glue did not expose the heap to the harness.

### How to reproduce

Everything is in `/home/brook/.cache/quire-codec-trials/c/`. Scripts there: `env.sh` (paths and the
`taskset -c 8-11 nice -n 10` prefix), `bwebp.sh`, `baom.sh`, `bjxl.sh`, `bjpeg.sh` (one library each),
`link.sh` (one module), `buildall.sh` (every variant), `webp-ladder.sh`, `sz.sh` and `passes.sh`
(sizes), `runs.sh` with `plan-main.txt` (times), `quality.py`, `report.py`. Wrappers in `wrap/`, the
harness in `harness/run-c.mjs`.

```
git clone --depth 1 https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh

# a library, here libwebp at Oz (each script runs emcmake cmake, then ninja -j4)
emcmake cmake libwebp -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS_RELEASE= \
  -DCMAKE_C_FLAGS="-Oz -msimd128 -flto -DNDEBUG -DWEBP_REDUCE_SIZE -DWEBP_DISABLE_STATS" \
  -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF ... -DWEBP_USE_THREAD=OFF -DWEBP_NEAR_LOSSLESS=OFF
ninja -j4 webp sharpyuv

# libaom adds: -DCONFIG_AV1_DECODER=0 -DCONFIG_AV1_HIGHBITDEPTH=0 -DCONFIG_DENOISE=0 \
#   -DCONFIG_RUNTIME_CPU_DETECT=0 -DENABLE_WASM_X86_INTRINSICS=1 -DCONFIG_MULTITHREAD=0, and
#   -sSUPPORT_LONGJMP=wasm in the C flags; libavif then uses -DAVIF_CODEC_AOM=SYSTEM
#   -DAVIF_CODEC_AOM_DECODE=OFF -DAOM_INCLUDE_DIR=... -DAOM_LIBRARY=.../libaom.a
# libjxl adds: -DHWY_COMPILE_ONLY_STATIC=1, -DJPEGXL_ENABLE_WASM_THREADS=OFF,
#   -DJPEGXL_ENABLE_TRANSCODE_JPEG=OFF -DJPEGXL_ENABLE_BOXES=OFF -DJPEGXL_ENABLE_SKCMS=ON

# the module
emcc -Oz -msimd128 -flto -sSTANDALONE_WASM --no-entry -sFILESYSTEM=0 -sMALLOC=emmalloc \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sSTACK_SIZE=1MB \
  -sEXPORTED_FUNCTIONS=_q_alloc,_q_free,_q_out_ptr,_q_info,_q_opt,_encode \
  wrap/webp.c libwebp.a libsharpyuv.a -o webp.wasm
# threaded instead: -pthread at compile and link, -sPTHREAD_POOL_SIZE=4 -sMODULARIZE -sEXPORT_ES6
#   -sENVIRONMENT=web,worker, output webp.mjs
# optional: -Wl,--wrap=fprintf,...,--wrap=getenv with wrap/wraps.c

wasm-opt -Oz --converge --strip-debug --strip-producers --enable-simd ... webp.wasm -o webp.opt.wasm
brotli -q 11 -w 24 webp.opt.wasm

# the split
wasm-split --instrument in.wasm -o inst.wasm      # run typical encodes, call __write_profile
wasm-split --split --profile=p.prof in.wasm -o1 first.wasm -o2 second.wasm \
  --export-prefix=% --placeholder-namespace=placeholder
```

## Scratch folder

`/home/brook/.cache/quire-codec-trials/`, about 12 GB, most of it Cargo build folders. `ws/` holds the
crates, `harness/` the test picture maker and runner, `images/` the test pictures and the raw sample,
`out/` and `native/` the encoded files, `sizes.csv` and the `results-*.jsonl` files the numbers,
`tools/` the local binaryen. Delete `target/` and `target-bstd/` to get most of the space back.

The C trial is in `c/` inside it, 2.2 GB after its build folders were deleted: emsdk 1.9 GB, the library
sources 0.4 GB, and the scripts, wrappers, logs and numbers (`sizes-c.csv`, `results-c.jsonl`,
`quality-c.jsonl`, `report.txt`). The whole scratch folder is now 3.1 GB. Deleting `c/emsdk` frees most
of it; `./emsdk install latest` brings it back.

## Sources

- jxl-encoder: https://github.com/imazen/jxl-encoder, https://crates.io/crates/jxl-encoder
- zune-jpegxl: https://github.com/etemesi254/zune-image/tree/dev/crates/zune-jpegxl
- jpegxl-rs: https://github.com/inflation/jpegxl-rs
- jxl-oxide: https://github.com/tirr-c/jxl-oxide
- jxl-rs: https://github.com/libjxl/jxl-rs
- Chrome JPEG XL: https://developer.chrome.com/blog/jpeg-xl-in-chrome
- oxideav-jpegxl: https://github.com/OxideAV/oxideav-jpegxl
- gamut: https://github.com/justin13888/gamut
- ravif and cavif: https://github.com/kornelski/cavif-rs
- rav1e: https://github.com/xiph/rav1e
- avif-serialize: https://github.com/kornelski/avif-serialize
- avif-parse: https://github.com/kornelski/avif-parse
- avif-decode: https://github.com/kornelski/avif-decode
- libavif-rs: https://github.com/njaard/libavif-rs
- svt-av1-enc: https://github.com/Vaider7/svt-av1-enc
- shiguredo_svt_av1: https://github.com/shiguredo/svt-av1-rs
- rav1d: https://github.com/memorysafety/rav1d
- dav1d-rs: https://github.com/rust-av/dav1d-rs
- zenavif: https://github.com/imazen/zenavif
- zenjpeg: https://github.com/imazen/zenjpeg
- jpeg-encoder: https://github.com/vstroebel/jpeg-encoder
- mozjpeg-rust: https://github.com/ImageOptim/mozjpeg-rust
- jpegli-rs (old): https://github.com/Szpadel/jpegli-rs
- zune-jpeg: https://github.com/etemesi254/zune-image
- oxipng: https://github.com/oxipng/oxipng
- zopfli: https://github.com/zopfli-rs/zopfli
- png: https://github.com/image-rs/image-png
- zenpng: https://github.com/imazen/zenpng
- zenzop: https://github.com/imazen/zenzop
- libimagequant: https://github.com/ImageOptim/libimagequant
- quantette: https://github.com/IanManske/quantette
- color_quant: https://github.com/image-rs/color_quant
- exoquant: https://github.com/exoticorn/exoquant-rs
- zenquant: https://github.com/imazen/zenquant
- image-webp: https://github.com/image-rs/image-webp
- zenwebp: https://github.com/imazen/zenwebp
- webp: https://github.com/jaredforth/webp
- libwebp-sys: https://github.com/NoXF/libwebp-sys
- webp-animation: https://github.com/blaind/webp-animation
- heic: https://github.com/imazen/heic
- heic-rs: https://github.com/tbraun96/heic-rs
- heif-oxide: https://github.com/dan335/heif-oxide
- rust_h265: https://github.com/roticv/rust_h265
- zune-heic: https://github.com/etemesi254/zune-image/tree/dev/crates/zune-heic
- heifer: https://github.com/HarpeLm/Heifer
- heic-decoder: https://github.com/Multipad-cyber/heic-decoder-rust
- libheif-rs: https://github.com/Cykooz/libheif-rs
- rawloader: https://github.com/pedrocr/rawloader
- imagepipe: https://github.com/pedrocr/imagepipe
- rawler (dnglab): https://github.com/dnglab/dnglab
- quickraw: https://github.com/qdwang/quickraw
- libraw-rs: https://github.com/paolobarbolini/libraw-rs
- Raw sample: https://raw.pixls.us/data/Sony/ILCE-7M3/
- tiff: https://github.com/image-rs/image-tiff
- hayro-jpeg2000: https://github.com/LaurenzV/hayro
- jpeg2k: https://github.com/Neopallium/jpeg2k
- openjp2: https://github.com/Neopallium/openjp2
- psd: https://github.com/chinedufn/psd
- gif: https://github.com/image-rs/image-gif
- little_exif: https://github.com/TechnikTobi/little_exif
- img-parts: https://github.com/paolobarbolini/img-parts
- kamadak-exif: https://github.com/kamadak/exif-rs
- nom-exif: https://github.com/mindeng/nom-exif
- xmp-writer: https://github.com/typst/xmp-writer
- xmp_toolkit: https://github.com/adobe/xmp-toolkit-rs
- rexiv2: https://github.com/felixc/rexiv2
- moxcms: https://github.com/awxkee/moxcms
- qcms: https://github.com/FirefoxGraphics/qcms
- lcms2: https://github.com/kornelski/rust-lcms2
- kolor: https://github.com/kabergstrom/kolor
- fast_image_resize: https://github.com/cykooz/fast_image_resize
- resize: https://github.com/PistonDevelopers/resize
- pic-scale: https://github.com/awxkee/pic-scale
- yuv: https://github.com/awxkee/yuvutils-rs
- palette: https://github.com/Ogeon/palette
- binaryen: https://github.com/WebAssembly/binaryen
- Emscripten SDK: https://github.com/emscripten-core/emsdk
- libjxl: https://github.com/libjxl/libjxl
- jpegli: https://github.com/google/jpegli
- libaom: https://aomedia.googlesource.com/aom
- libavif: https://github.com/AOMediaCodec/libavif
- SVT-AV1: https://gitlab.com/AOMediaCodec/SVT-AV1
- libwebp: https://chromium.googlesource.com/webm/libwebp
- mozjpeg: https://github.com/mozilla/mozjpeg
- crates.io API for versions, dates, downloads and licences: https://crates.io/api/v1/crates/
