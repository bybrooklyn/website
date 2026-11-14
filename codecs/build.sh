#!/bin/bash
# Builds imgQuire's encoders (and its HEIC reader) to WebAssembly, each its own module, into
# public/quire/codecs/, and writes their pins (src/quire/img/codecs.json): each file's SHA-256, its
# size, and the source it was built from. The page fetches a module only when its format is picked
# and refuses one whose bytes do not match its pin. Choices and measurements: docs/imgQuire-codecs.md.
#
#   codecs/build.sh            every module
#   codecs/build.sh webp jxl   only these
#
# Needs: Emscripten's SDK and the libraries' sources, both from the codec trial (SOURCES, EMSDK below,
# each checked out at the commit pinned here), Rust with the wasm32-unknown-unknown target, the crates
# in Cargo's cache (it builds offline), clang with a wasm target (oxipng compiles libdeflate), brotli.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SITE=$(cd "$HERE/.." && pwd)
TRIALS=${TRIALS:-$HOME/.cache/quire-codec-trials}
SOURCES=${SOURCES:-$TRIALS/c/src}
EMSDK=${EMSDK:-$TRIALS/c/emsdk}
WORK=${WORK:-$TRIALS/quire-build}
OUT=$SITE/public/quire/codecs
PINS=$SITE/src/quire/img/codecs.json
RUN="taskset -c 8-11 nice -n 10"

# the sources each module is built from, at the commits the trial measured
declare -A COMMIT=(
    [libwebp]=f9c049d57323a51b51390bf6a1ad71c4dc008bb2
    [jpegli]=031a0077f5799a6041004267fc12b956c1f52a20
    [libjxl]=9e0207106a686457572491824687cfa8d39c0892
    [aom]=bcc98e0c3a88a3ad1807eca2bc179ef8d7abf091
    [libavif]=90d3b6661e1475bb1652cba7d85c24f8c748ab07
)

source "$EMSDK/emsdk_env.sh" > /dev/null 2>&1
export PATH="$EMSDK/upstream/bin:$PATH"
mkdir -p "$OUT" "$WORK"

check() {
    local found
    found=$(cat "$SOURCES/$1/.git/shallow" 2>/dev/null || cat "$SOURCES/$1/.git/HEAD")
    [ "$found" = "${COMMIT[$1]}" ] || { echo "$1 is at $found, not the pinned ${COMMIT[$1]}"; exit 1; }
}

# a CMake library build: <name> <source> <compiler flags> <targets> [cmake arguments]
library() {
    local name=$1 source=$2 flags=$3 targets=$4
    shift 4
    local build=$WORK/$name
    rm -rf "$build"
    mkdir -p "$build"
    (cd "$build" && $RUN emcmake cmake "$SOURCES/$source" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_C_FLAGS_RELEASE= -DCMAKE_CXX_FLAGS_RELEASE= \
        -DCMAKE_C_FLAGS="$flags" -DCMAKE_CXX_FLAGS="$flags -fno-exceptions -fno-rtti" -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF "$@" > cmake.log 2>&1 &&
        $RUN ninja -j4 $targets > ninja.log 2>&1) || { tail -30 "$build"/*.log; exit 1; }
}

# a standalone module with no JavaScript glue: <name> <flags> <wrapper> <include dirs and libraries...>
module() {
    local name=$1 flags=$2 wrapper=$3
    shift 3
    $RUN emcc $flags -sSTANDALONE_WASM --no-entry -sFILESYSTEM=0 -sMALLOC=emmalloc -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB \
        -sSTACK_SIZE=1MB -sEXPORTED_FUNCTIONS=_q_alloc,_q_free,_q_out_ptr,_q_info,_q_opt,_encode \
        -Wl,--wrap=fprintf,--wrap=vfprintf,--wrap=printf,--wrap=fputs,--wrap=puts,--wrap=fputc,--wrap=fwrite,--wrap=fflush,--wrap=getenv \
        -I"$HERE/wrap" "$HERE/wrap/$wrapper" "$HERE/wrap/wraps.c" "$@" -o "$WORK/$name.wasm"
    finish "$WORK/$name.wasm" "$name"
}

# shrinks a module, keeps it in the site, and notes its size and checksum
finish() {
    # only the features every current browser has, so that the optimizer uses no newer ones
    wasm-opt -Oz --converge --strip-debug --strip-producers --enable-simd --enable-bulk-memory --enable-nontrapping-float-to-int \
        --enable-sign-ext --enable-mutable-globals --enable-multivalue --enable-reference-types --enable-exception-handling "$1" -o "$OUT/$2.wasm"
    echo "$2: $(stat -c %s "$OUT/$2.wasm") bytes, $(brotli -q 11 -w 24 -c "$OUT/$2.wasm" | wc -c) with brotli"
}

webp() {
    check libwebp
    library webp libwebp "-Oz -msimd128 -flto -DNDEBUG -DWEBP_REDUCE_SIZE -DWEBP_DISABLE_STATS" "webp sharpyuv" \
        -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF \
        -DWEBP_BUILD_VWEBP=OFF -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_LIBWEBPMUX=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF \
        -DWEBP_USE_THREAD=OFF -DWEBP_NEAR_LOSSLESS=OFF
    module webp "-Oz -msimd128 -flto" webp.c -I"$SOURCES/libwebp/src" "$WORK/webp/libwebp.a" "$WORK/webp/libsharpyuv.a"
}

jpegli() {
    check jpegli
    library jpegli jpegli "-Oz -msimd128 -flto -DNDEBUG" jpegli-static \
        -DJPEGLI_ENABLE_TOOLS=OFF -DJPEGLI_ENABLE_DOXYGEN=OFF -DJPEGLI_ENABLE_MANPAGES=OFF -DJPEGLI_ENABLE_BENCHMARK=OFF \
        -DJPEGLI_ENABLE_JNI=OFF -DJPEGLI_ENABLE_SJPEG=OFF -DJPEGLI_ENABLE_OPENEXR=OFF -DJPEGLI_BUNDLE_LIBPNG=OFF \
        -DJPEGLI_ENABLE_WASM_THREADS=OFF -DJPEGLI_ENABLE_FUZZERS=OFF -DJPEGLI_ENABLE_SKCMS=ON
    module jpegli "-Oz -msimd128 -flto -sDEFAULT_TO_CXX=1 -lc++ -lc++abi" jpegli.cc -I"$SOURCES/jpegli" -I"$WORK/jpegli/lib/include/jpegli" -I"$WORK/jpegli/lib/include" \
        "$WORK/jpegli/lib/libjpegli-static.a" "$WORK/jpegli/third_party/highway/libhwy.a"
}

jxl() {
    check libjxl
    library jxl libjxl "-Os -msimd128 -flto -DNDEBUG -DHWY_COMPILE_ONLY_STATIC=1" "jxl jxl_cms" \
        -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_BENCHMARK=OFF \
        -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_JNI=OFF -DJPEGXL_ENABLE_SJPEG=OFF -DJPEGXL_ENABLE_OPENEXR=OFF \
        -DJPEGXL_BUNDLE_LIBPNG=OFF -DJPEGXL_ENABLE_SKCMS=ON -DJPEGXL_ENABLE_TRANSCODE_JPEG=OFF -DJPEGXL_ENABLE_BOXES=OFF \
        -DJPEGXL_ENABLE_WASM_THREADS=OFF -DJPEGXL_ENABLE_FUZZERS=OFF
    module jxl "-Os -msimd128 -flto -sDEFAULT_TO_CXX=1 -lc++ -lc++abi" jxl.c -I"$SOURCES/libjxl/lib/include" -I"$WORK/jxl/lib/include" \
        $(find "$WORK/jxl" -name '*.a' | sort)
}

avif() {
    check aom
    check libavif
    local flags="-Os -msimd128 -flto -DNDEBUG -sSUPPORT_LONGJMP=wasm"
    library aom aom "$flags" aom \
        -DCONFIG_AV1_DECODER=0 -DCONFIG_AV1_HIGHBITDEPTH=0 -DCONFIG_DENOISE=0 -DCONFIG_RUNTIME_CPU_DETECT=0 -DCONFIG_WEBM_IO=0 \
        -DCONFIG_LIBYUV=0 -DCONFIG_MULTITHREAD=0 -DENABLE_WASM_X86_INTRINSICS=1 -DENABLE_DOCS=0 -DENABLE_EXAMPLES=0 \
        -DENABLE_TESTS=0 -DENABLE_TOOLS=0 -DENABLE_APPS=0 -DENABLE_TESTDATA=0
    library avif libavif "$flags" avif \
        -DAVIF_CODEC_AOM=SYSTEM -DAVIF_CODEC_AOM_DECODE=OFF -DAVIF_CODEC_AOM_ENCODE=ON -DAOM_INCLUDE_DIR="$SOURCES/aom" \
        -DAOM_LIBRARY="$WORK/aom/libaom.a" -DAVIF_LIBYUV=OFF -DAVIF_LIBSHARPYUV=OFF -DAVIF_LIBXML2=OFF -DAVIF_JPEG=OFF \
        -DAVIF_ZLIBPNG=OFF -DAVIF_BUILD_APPS=OFF
    avifmodule
}

# the AVIF module linked again from the libraries already built, after a change to its wrapper
avifmodule() {
    module avif "-Os -msimd128 -flto -DNDEBUG -sSUPPORT_LONGJMP=wasm" avif.c -I"$SOURCES/libavif/include" "$WORK/avif/libavif_internal.a" "$WORK/aom/libaom.a"
}

# the two written in Rust: oxipng for PNG and heic-rs for reading HEIC, built offline from Cargo's cache
rust() {
    (cd "$HERE/rust" && CARGO_TARGET_DIR="$WORK/rust" RUSTFLAGS="-C target-feature=+bulk-memory,+simd128" \
        $RUN cargo build --offline --release --target wasm32-unknown-unknown -j4 > "$WORK/rust.log" 2>&1) || { tail -30 "$WORK/rust.log"; exit 1; }
    finish "$WORK/rust/wasm32-unknown-unknown/release/quire_oxipng.wasm" oxipng
    finish "$WORK/rust/wasm32-unknown-unknown/release/quire_heic.wasm" heic
}

# shrinks the modules already built again, after a change to how they are shrunk
again() {
    for name in webp jpegli jxl avif; do finish "$WORK/$name.wasm" "$name"; done
    finish "$WORK/rust/wasm32-unknown-unknown/release/quire_oxipng.wasm" oxipng
    finish "$WORK/rust/wasm32-unknown-unknown/release/quire_heic.wasm" heic
}

# notices only: codecs/build.sh notices
notices_only() { :; }
for each in ${@:-webp jpegli jxl avif rust}; do [ "$each" = notices ] || $each; done

# the libraries' notices, beside the modules: for each module, what it was built from and the copyright
# and license text of everything linked into it, copied from the very files it was built from
REGISTRY=$(ls -d "${CARGO_HOME:-$HOME/.cargo}"/registry/src/*/ | head -1)
RUNTIME=$EMSDK/upstream/emscripten
notice() { # <title> <file>
    [ -f "$2" ] || { echo "no notice file $2"; exit 1; }
    printf '\n----- %s -----\n\n' "$1"
    cat "$2"
}
crate() { # <name-version> <license used> <files...>
    local folder=$REGISTRY$1
    shift
    local used=$1
    shift
    printf '\n%s (%s), from crates.io\n' "${folder##*/}" "$used"
    for file in "$@"; do notice "${folder##*/} $file" "$folder/$file"; done
}
emscripten() {
    printf '\nEmscripten runtime linked into the module: musl libc, emmalloc, libc++, libc++abi, compiler-rt\n'
    notice "Emscripten LICENSE" "$RUNTIME/LICENSE"
    notice "musl COPYRIGHT" "$RUNTIME/system/lib/libc/musl/COPYRIGHT"
    notice "libc++ LICENSE.TXT" "$RUNTIME/system/lib/libcxx/LICENSE.TXT"
    notice "libc++abi LICENSE.TXT" "$RUNTIME/system/lib/libcxxabi/LICENSE.TXT"
    notice "compiler-rt LICENSE.TXT" "$RUNTIME/system/lib/compiler-rt/LICENSE.TXT"
}
rustlib() {
    printf '\nThe Rust standard library linked into the module, used under the MIT license (The Rust Project Developers)\n'
    notice "Rust MIT" "$(rustc --print sysroot)/share/doc/rust/licenses/MIT.txt"
}
section() { printf '\n\n================ %s ================\n' "$1"; }
{
    echo "Open-source notices for imgQuire's encoders"
    echo
    echo "Each module in this folder is a binary copy of the libraries named under it, built by codecs/build.sh"
    echo "in the site's source. Their copyright notices and license texts follow, copied from the sources built."

    section "jpegli.wasm: JPEG"
    printf '\njpegli, commit %s, from https://github.com/google/jpegli\n' "${COMMIT[jpegli]}"
    notice "jpegli LICENSE" "$SOURCES/jpegli/LICENSE"
    notice "jpegli PATENTS" "$SOURCES/jpegli/PATENTS"
    notice "jpegli AUTHORS" "$SOURCES/jpegli/AUTHORS"
    printf '\nHighway, bundled with jpegli\n'
    notice "Highway LICENSE" "$SOURCES/jpegli/third_party/highway/LICENSE"
    printf '\nskcms, bundled with jpegli\n'
    notice "skcms LICENSE" "$SOURCES/jpegli/third_party/skcms/LICENSE"
    emscripten

    section "webp.wasm: WebP"
    printf '\nlibwebp, commit %s, from https://chromium.googlesource.com/webm/libwebp\n' "${COMMIT[libwebp]}"
    notice "libwebp COPYING" "$SOURCES/libwebp/COPYING"
    notice "libwebp PATENTS" "$SOURCES/libwebp/PATENTS"
    notice "libwebp AUTHORS" "$SOURCES/libwebp/AUTHORS"
    emscripten

    section "avif.wasm: AVIF"
    printf '\nlibavif, commit %s, from https://github.com/AOMediaCodec/libavif\n' "${COMMIT[libavif]}"
    notice "libavif LICENSE" "$SOURCES/libavif/LICENSE"
    printf '\nlibaom, commit %s, from https://aomedia.googlesource.com/aom\n' "${COMMIT[aom]}"
    notice "libaom LICENSE" "$SOURCES/aom/LICENSE"
    notice "libaom PATENTS" "$SOURCES/aom/PATENTS"
    notice "libaom AUTHORS" "$SOURCES/aom/AUTHORS"
    printf '\nfastfeat, bundled with libaom\n'
    notice "fastfeat LICENSE" "$SOURCES/aom/third_party/fastfeat/LICENSE"
    emscripten

    section "jxl.wasm: JPEG XL"
    printf '\nlibjxl, commit %s, from https://github.com/libjxl/libjxl\n' "${COMMIT[libjxl]}"
    notice "libjxl LICENSE" "$SOURCES/libjxl/LICENSE"
    notice "libjxl PATENTS" "$SOURCES/libjxl/PATENTS"
    notice "libjxl AUTHORS" "$SOURCES/libjxl/AUTHORS"
    printf '\nHighway, brotli and skcms, bundled with libjxl\n'
    notice "Highway LICENSE" "$SOURCES/libjxl/third_party/highway/LICENSE"
    notice "brotli LICENSE" "$SOURCES/libjxl/third_party/brotli/LICENSE"
    notice "skcms LICENSE" "$SOURCES/libjxl/third_party/skcms/LICENSE"
    emscripten

    section "oxipng.wasm: PNG"
    crate oxipng-10.2.1 MIT LICENSE
    crate libdeflater-1.26.1 Apache-2.0 LICENSE
    crate libdeflate-sys-1.26.1 Apache-2.0 LICENSE
    printf '\nlibdeflate, inside libdeflate-sys 1.26.1\n'
    notice "libdeflate COPYING" "${REGISTRY}libdeflate-sys-1.26.1/libdeflate/COPYING"
    crate bytemuck-1.25.2 "used under MIT; also Zlib or Apache-2.0" LICENSE-MIT
    crate equivalent-1.0.3 "used under MIT; also Apache-2.0" LICENSE-MIT
    crate hashbrown-0.17.1 "used under MIT; also Apache-2.0" LICENSE-MIT
    crate indexmap-2.14.2 "used under MIT; also Apache-2.0" LICENSE-MIT
    crate log-0.4.35 "used under MIT; also Apache-2.0" LICENSE-MIT
    crate rgb-0.8.53 MIT LICENSE
    crate rustc-hash-2.1.3 "used under MIT; also Apache-2.0" LICENSE-MIT
    rustlib

    section "heic.wasm: reading HEIC"
    crate heic-rs-0.1.4 "used under MIT; also Apache-2.0" LICENSE-MIT NOTICE
    rustlib
} > "$OUT/NOTICES.txt"
# every crate linked into a Rust module has its notice, so that the file cannot fall out of step with Cargo.lock
for each in $(cd "$HERE/rust" && cargo tree --offline --target wasm32-unknown-unknown -e normal --prefix none | grep -v -e "(/" -e "^$" | sort -u | awk '{ print $1 "-" substr($2, 2) }'); do
    grep -q "^$each (" "$OUT/NOTICES.txt" || { echo "no notice for the crate $each"; exit 1; }
done

# the pins, one module to a line, read by src/quire/img/codecs.ts
{
    echo "["
    first=1
    for file in "$OUT"/*.wasm; do
        name=$(basename "$file" .wasm)
        case $name in
            webp) source="libwebp ${COMMIT[libwebp]:0:7}" ;;
            jpegli) source="jpegli ${COMMIT[jpegli]:0:7}" ;;
            jxl) source="libjxl ${COMMIT[libjxl]:0:7}" ;;
            avif) source="libavif ${COMMIT[libavif]:0:7} with libaom ${COMMIT[aom]:0:7}" ;;
            oxipng) source="oxipng 10.2.1" ;;
            heic) source="heic-rs 0.1.4" ;;
        esac
        [ $first = 1 ] || echo ","
        first=0
        printf '  {"name": "%s", "sha256": "%s", "bytes": %s, "brotli": %s, "source": "%s"}' "$name" "$(sha256sum "$file" | cut -d' ' -f1)" \
            "$(stat -c %s "$file")" "$(brotli -q 11 -w 24 -c "$file" | wc -c)" "$source"
    done
    printf '\n]\n'
} > "$PINS"
cat "$PINS"
