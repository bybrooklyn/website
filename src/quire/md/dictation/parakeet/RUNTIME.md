# How the speech models are run

`runtime.ts` loads a Parakeet model's two files into ONNX Runtime Web (ORT) and runs the encoder.
This page is what was measured to make it, and what to do next. Everything marked **untested** was
written from ORT's documentation and was not run here.

Measured on one machine (16 threads, RTX 3070 Ti, and an AMD Radeon 610M integrated GPU), Chromium
156, onnxruntime-web 1.24.1, spoken test sentences made by `espeak-ng` (11 s and 25 s of audio).
Speed is encoder time over sound time. "Warm" is a second load in the same page.

## 1. The runtime's size

`onnxruntime-web` 1.24.1 holds these builds (raw bytes, then brotli as a visitor downloads it):

| Build | Raw | Brotli | What it is |
| --- | --- | --- | --- |
| `ort-wasm-simd-threaded.wasm` | 12,297,086 | 1,966,354 | CPU only |
| `ort-wasm-simd-threaded.jsep.wasm` | 24,911,187 | 3,284,689 | CPU and WebGPU (JSEP: GPU kernels written in JavaScript) |
| `ort-wasm-simd-threaded.jspi.wasm` | 16,796,269 | 2,456,704 | native WebGPU EP, Chrome with JSPI only |
| `ort-wasm-simd-threaded.asyncify.wasm` | 27,084,114 | 3,625,703 | native WebGPU EP, any browser (over Cloudflare's 25 MiB limit) |

Each is loaded by a JavaScript entry: `ort.wasm.min.mjs` (50 kB, 14 kB brotli), `ort.min.mjs`
(358 kB, 80 kB; this is the JSEP one), and the glue `ort-wasm-simd-threaded[.jsep].mjs` (24 kB and 47 kB).

**Before.** The page imported `onnxruntime-web` whole: the 403 kB bundle (92 kB brotli) and the 24.9 MB JSEP
file (3.28 MB brotli) for every visitor, 3.38 MB brotli.
**After.** A browser without WebGPU downloads `ort.wasm.min.mjs`, its glue and the 12.3 MB file: 12.37 MB
raw, **1.99 MB brotli**. A browser with a card downloads the JSEP set, 25.3 MB raw, 3.38 MB brotli, the same
as before, because WebGPU needs that file. `astro.config.ts` (the `ort-files` integration) copies the six files
into `/ort/`, unhashed, and `RUNTIME = "/ort/"` in `src/quire/core/onnx.ts` (the loader dictation and imgQuire's text reader share) is where they are fetched from. Nothing is
bundled; `onnxruntime-web` is read only at build time. The old `?url` import in `engine-worker.ts` that made the
build emit the 24.9 MB file into `_astro/` is gone: the engine worker now gets ONNX Runtime from `/ort/` through
`runtime.ts`, and `dist/_astro/` holds no `.wasm`.

The native WebGPU builds (jspi, asyncify) are not shipped: they loaded and ran, but gave **wrong output** for
every quantized encoder here (empty transcript; with the default output location, "Buffer used in submit while
destroyed"), while the fp32 Moonshine encoder was right on all of them. Only JSEP is correct.

### Files `/ort/*` need cache headers

Done: `public/_headers` has a rule for `/ort/*` of a day, then check again (`max-age=86400, stale-while-revalidate=604800`),
like `/wasm/*`. The files are not hashed, so they are not `immutable`.

## 2. A smaller runtime of her own (untested)

ORT's own docs give no wasm size for a reduced build, so there is no figure to quote. Reducing the operator
set removes most CPU kernels (we use 37 of several hundred), so a few megabytes is plausible, but that is an
estimate, not a measurement.

### Operators our models use

Read straight out of the `.onnx` files by a small protobuf reader (counts are nodes). The reader is not in the
repo; it walks `ModelProto.graph.node`, including `If` subgraphs.

- Parakeet encoders (int8 Ultra, w2a8 Redux, w4a8): `ai.onnx` opset 17: Add 204, Cast 18, Concat 68, Conv 29,
  Cos, Div 27, Equal 18, Expand 18, Flatten, Gather 96, GreaterOrEqual, LayerNormalization 120, Less 4,
  MatMul 72, Mul 156, Neg, Range 7, Relu 3, Reshape 145, Shape 61, Sigmoid 96, Sin, Softmax 24, Split 24,
  Sub 6, Transpose 291, Unsqueeze 92, Where 42; `com.microsoft` `MatMulNBits` 265 (8-bit in Ultra, 2-bit in
  Redux, 4-bit in w4a8). The fp16 encoder is the same graph with Cast and no MatMulNBits.
- Parakeet decoder_joint int8: Add, Cast, Concat, Constant, DequantizeLinear, DynamicQuantizeLinear, Gather,
  Identity, MatMulInteger, Mul, ReduceLogSumExp, Relu, Slice, Squeeze, TopK, Transpose, Unsqueeze, and
  `com.microsoft` `DynamicQuantizeLSTM` 2.
- Moonshine tiny, fp32 encoder, opset 14: Add, Cast, Concat, Conv, Cos, Div, Erf, Gather, InstanceNormalization,
  MatMul, Mul, Neg, Pow, Range, ReduceMean, Reshape, Shape, Sigmoid, Sin, Slice, Softmax, Sqrt, Sub, Tanh,
  Transpose, Unsqueeze.
- Moonshine tiny int8 decoder, opset 14: the above plus Constant, ConstantOfShape, DequantizeLinear,
  DynamicQuantizeLinear, Equal, Expand, Greater, If, MatMulInteger, Trilu, Where.

This is the ONNX-level list. Converting to ORT format fuses nodes (it can add `FusedMatMul`, `NhwcConv`,
`QLinear*` and similar), so **generate the real config from the converted files**, as step 2 below does, and
treat the following as a check on it:

```
#domain;opset;ops
ai.onnx;17;Add,Cast,Concat,Constant,Conv,Cos,DequantizeLinear,Div,DynamicQuantizeLinear,Equal,Expand,Flatten,Gather,GreaterOrEqual,Identity,LayerNormalization,Less,MatMul,MatMulInteger,Mul,Neg,Range,ReduceLogSumExp,Relu,Reshape,Shape,Sigmoid,Sin,Slice,Softmax,Split,Squeeze,Sub,TopK,Transpose,Unsqueeze,Where
ai.onnx;14;Add,Cast,Concat,Constant,ConstantOfShape,Conv,Cos,DequantizeLinear,Div,DynamicQuantizeLinear,Equal,Erf,Expand,Gather,Greater,If,InstanceNormalization,MatMul,MatMulInteger,Mul,Neg,Pow,Range,ReduceMean,Reshape,Shape,Sigmoid,Sin,Slice,Softmax,Sqrt,Sub,Tanh,Transpose,Trilu,Unsqueeze,Where
com.microsoft;1;DynamicQuantizeLSTM,MatMulNBits
```

### Recipe (untested)

1. Convert the models to ORT format (a minimal build cannot read `.onnx`), with type reduction so the config
   records types, from a folder holding every model of every tier:
   ```sh
   pip install onnxruntime
   python -m onnxruntime.tools.convert_onnx_models_to_ort ./models --optimization_style Fixed --enable_type_reduction
   ```
   This writes `.ort` files and `required_operators_and_types.config` (and a `.with_runtime_opt` variant). Use
   `--optimization_style Fixed` for a minimal build, which cannot optimize at load. Files larger than the
   2 GB flatbuffer limit cannot be converted; ours are under it. The `.ort` encoders replace the `.onnx` ones in
   the model table (`path`, `bytes`), and `runtime.ts` passes them to `InferenceSession.create` unchanged.
2. Check out `onnxruntime` at tag `v1.24.1` with submodules (`git clone --recursive`, `git checkout v1.24.1`,
   `git submodule update --init --recursive`). The emsdk version is whatever that tag pins; read it from
   `tools/ci_build/github/azure-pipelines/templates/linux-wasm-ci.yml` there (the docs only say `latest`, which
   may not build). Needs CMake 3.26+, Node 18+, Python 3.9+, `pip install ninja`.
3. CPU build, SIMD and threads, reduced:
   ```sh
   ./build.sh --config MinSizeRel --build_wasm --enable_wasm_simd --enable_wasm_threads --skip_tests \
     --disable_wasm_exception_catching --disable_rtti --minimal_build \
     --include_ops_by_config ./required_operators_and_types.config --enable_reduced_operator_type_support
   ```
   Without threads (no cross-origin isolation needed, slightly smaller): the same without `--enable_wasm_threads`.
   Whether ORT's JavaScript for 1.24 accepts a file named differently from `ort-wasm-simd-threaded.wasm` was not
   checked; keep that name.
4. With WebGPU: add `--use_jsep`. The JSEP kernels are JavaScript in the glue, so only the CPU half of the
   wasm shrinks. Whether `--minimal_build` works together with `--use_jsep` was not checked; if it does not,
   leave `--minimal_build` off and keep `--include_ops_by_config`, which reduces the kernels without the ORT
   format. Our JSEP needs MatMulNBits for 4 bits only (see 3 below).
5. Build the package: in `js/`, `js/common/`, `js/web/` run `npm ci`; copy the `.wasm` and `.mjs` into
   `js/web/dist/`; `npm run build` in `js/web`.
6. Put the new `ort-wasm-simd-threaded.{mjs,wasm}` (and `.jsep.` pair) in `/ort/`: copy them over the ones named
   in `ORT` in `astro.config.ts`, or point that list's folder at your build. If the folder is elsewhere on the
   site or on a CDN, change `RUNTIME` in `src/quire/core/onnx.ts`: **that one line** is the whole switch.

## 3. The graphics card

Real WebGPU worked here (Chromium flags `--enable-unsafe-webgpu --enable-features=Vulkan --use-angle=vulkan`;
setting `VK_ICD_FILENAMES` to the Radeon's file picks the integrated GPU). SwiftShader
(`--use-webgpu-adapter=swiftshader`) gave the same checksums and text, 34 s for 3.4 s of audio, and reports
`isFallbackAdapter`, so `detect()` turns it down.

| Encoder | On JSEP WebGPU | Download |
| --- | --- | --- |
| int8 Ultra (MatMulNBits, 8 bits) | **cannot**: session creation fails, "Only 4b quantization is supported for MatMulNBits" | 649 MB |
| w2a8 Redux (2 bits) | cannot, same | 190 MB |
| **w4a8** (`Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx`, `w4a8/encoder-model.w4a8.onnx`, 383,355,483 bytes) | **works, text exact** | 383 MB |
| fp16 (`fp16/encoder-model.fp16.onnx`, 1,218,170,745 bytes) | works, text exact | 1.2 GB |

Encoder time for the 24.6 s sample, warm (decoder on WASM, int8):

| Arrangement | Encoder | Whole transcription | Speed |
| --- | --- | --- | --- |
| int8 Ultra, WASM 1 thread | about 11.5 s (5.2 s measured for 11 s of audio) | | 0.47 |
| w4a8 on RTX 3070 Ti | 0.40 s | 0.52 to 0.70 s | 0.016 |
| fp16 on RTX 3070 Ti | 0.17 s | 0.35 s | 0.007 |
| w4a8 on Radeon 610M (2 compute units) | 5.1 s | 5.3 s | 0.21 |

So **the arrangement to use is the w4a8 encoder on WebGPU with the int8 decoder on WASM**: it is smaller
than the int8 file the main tier ships (383 MB against 649 MB), identical in text on every sample here, and
on WASM it is no slower (4.9 s against 5.2 s for 11 s of audio, same words). Even the weakest card measured
beats one WASM thread by 2.3 times. fp16 is 2.4 times faster again but three times the download, and
needs a second 1.2 GB copy in memory while loading. Not yet done: a word error rate for w4a8 over more than
the 43 words of the standing test; the three sentences here came out exact.

Session options, by measurement (w4a8, 24.6 s, encoder ms over five runs):

| Option | Result |
| --- | --- |
| `graphOptimizationLevel` all, extended, basic, disabled | 402 to 428: no difference. `all` kept. |
| `executionMode: "parallel"` | 418 to 436: no gain |
| `preferredOutputLocation: "gpu-buffer"` | 417 to 433: no gain, since the decoder is on the CPU and the output has to be downloaded anyway. Needed for the native builds only. |
| `enableGraphCapture: true` | **23 times slower** (9.6 s): the frame count changes, so the capture never replays. Not used. |
| `preferredLayout: "NHWC"` | 386 to 455: noise |
| IO binding | not tried: it only pays when the output stays on the card |

Profiling (`env.webgpu.profiling`) shows 1,270 kernels a run on the card, MatMulNBits 87 % of the 191 ms of
GPU time, LayerNormalization 15 ms, everything else under 5 ms each. The minimal web build does not report
which nodes went to the CPU ("Rerunning with verbose output on a non-minimal build will show node
assignments"); the shape arithmetic (Shape, Unsqueeze, Equal, Less, Reshape) does, and the run takes 213 ms
wall against 191 ms on the card, so the CPU side costs about 20 ms. The first run on a card compiles its
programs and took 0.6 to 0.9 s; `load()` makes one run over silence so that cost is in the load, not in the
first words.

### Making an fp16 or int4 encoder yourself

fp16 exists already (above). **Untested**: for a checkpoint with no fp16 export, with `onnxconverter-common`:
`from onnxconverter_common import float16; m = float16.convert_float_to_float16(onnx.load("encoder-model.onnx", load_external_data=True), keep_io_types=True); onnx.save(m, "encoder-model.fp16.onnx")`. The Olicorne repository has `scripts/quantize-fp16.py` and `scripts/build-from-nemo-export.sh` that do this
properly for these models. The 4-bit file is made by the same scripts (`w4a8`). `ryusei-46/parakeet-ultra-ONNX-WebGPU`
has an int4 encoder in `encoder.onnx` plus `encoder.onnx.data` (not tried on a card; it needs
`externalData`, which `load()` does not take, so use the single-file w4a8).

## 4. Threads

Done, by the owner's decision ("yes, on mdQuire's pages only"). `public/_headers` has these lines and no others for
isolation:

```
/mdquire/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/mdquire-dictation/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp

/_astro/*
  Cross-Origin-Embedder-Policy: require-corp      (beside its Cache-Control)

/ort/*
  Cross-Origin-Embedder-Policy: require-corp      (beside its new Cache-Control)
```

The last two are needed, and a `Cross-Origin-Resource-Policy` header cannot stand in for them: a worker's script must
carry an embedder policy at least as strict as the page that starts it, which is a rule about the worker's own
response, not about whether the page may embed it. The engine worker is in `/_astro/` and ONNX Runtime's thread
workers are `/ort/*.mjs`; without them the threaded run hung (200 s, no result). On a script or a stylesheet the
header changes nothing for another page that uses the file.

`require-corp` and not `credentialless`: both keep the downloads from `huggingface.co` (a ranged fetch, 206) and the
GitHub store (`api.github.com`, 200) working, since both answer CORS; the test was made with each. Safari does not
know `credentialless`, and its pages would have stayed on one thread. `require-corp` costs these pages nothing that
the page policy did not already take: its `<meta>` allows images, scripts, styles and fonts only from the site itself
(`img-src 'self' data: blob:`), so a picture from another site never loaded there. What the headers stop on `/mdquire/*`
that was possible before: **a cross-origin frame** (the policy allows `frame-src https:`) now loads only if the frame
sends `Cross-Origin-Resource-Policy: cross-origin` (tested: a page on another origin loaded in an iframe without
the headers, and did not with them, with or without its own COEP); and **a cross-origin `no-cors` fetch**. `COOP:
same-origin` cuts `window.opener` to any page that opens or is opened from these two (none do). mdQuire draws no frames: its reader drops
`iframe` from a document. (`bun run edit` does not send these headers, since its preview is a frame.)

Checked with a small server that applies `_headers` (python's does not), on a build: `/`, `/photos/`, a post with
pictures, `/minis/walker/` (its worker and wasm come from `/_astro/` and `/wasm/`), `/minis/plinko/`, `/spectrum/`
all load with no errors and are **not** isolated (`crossOriginIsolated` false); `/mdquire/` and `/mdquire-dictation/`
are isolated and show their editor with no errors.

The runtime uses half of `navigator.hardwareConcurrency`, from 1 to 8 threads, and one thread where
`crossOriginIsolated` is false. **Speed** (Chromium 156, 16 threads of this machine, the 24.6 s sample, real-time
factor = recognizing time over sound time, three runs each):

| Threads | Ultra w4a8 (processor) | Redux w2a8 (processor) |
| --- | --- | --- |
| 1 | 0.38 | 0.38 |
| 2 | 0.20 | 0.19 |
| 4 | 0.11 | 0.11 |
| 8 | 0.077 | 0.085 |

Four threads are a 3.5 times speed-up, eight 5 times. On the card, Ultra w4a8 is 0.023 with one thread and 0.020 with
eight (the threads speed up only the decoder), and 0.22 on the Radeon 610M.

## 5. Load times

Session creation (both sessions, and for a card the first compile run), after the files are in memory:

| | Cold (first load in a page) | Warm (second load in the same page) |
| --- | --- | --- |
| Ultra int8, WASM | 0.8 to 0.9 s | |
| Redux w2a8, WASM | 0.45 to 0.55 s | |
| w4a8, WASM | 0.77 s | 0.56 s |
| w4a8, RTX 3070 Ti | 2.1 s | 1.2 s |
| fp16, RTX 3070 Ti | 2.0 s | |

Cold includes compiling the wasm; the browser keeps compiled code for a page reload, so a real warm start
(the files already in storage) should be near the warm column; this machine's test server turned caching
off, so that was not measured. Fetching the model bytes from the local server took 0.1 to 0.7 s.

`release()` releases both sessions; memory comes back once the runtime frees its heap and the card its
buffers. Not measured separately from the dictation check.

## 6. Live words (stream.ts)

The encoder looks at a whole stretch of sound at once, so there is no state to carry between pieces of sound.
`stream.ts` carries the decoder's instead. Per phrase it keeps the raw log-mel frames (computed once, as the sound
arrives), the decoder's state at the *settled point*, and the words settled so far. A step encodes only from
`left` seconds before the settled point to the newest sound, with the features normalized over that window alone;
the encoder frames after the settled point except the last `right` seconds are decoded with the real state (so they
become settled, for good, and are never encoded as new again), and the rest is decoded on a copy of the state and
shown as tentative. A step starts when `chunk` seconds of new sound are in and no step is running, and it takes
in everything that has arrived, so a slow machine takes bigger steps (fewer repeats of the context) and the words
come later, instead of a queue growing without end.

**A window that starts in the middle of speech makes the encoder answer with nothing.** Measured: 4 s of the sentence
sound from 4.96 s on gave an empty transcript, from 5.5 s on likewise, and from 2.0 s on lost its first words; 0.24 s
of silence (or of faint noise) in front of the same sound gave every word. So a window that does not start at the
beginning of the phrase is given 24 frames of silence first (`LEAD` in `stream.ts`). This is not in the parakeet.js
streaming either; it is why a plain sliding window of this model loses whole sentences.

Word error of the finished phrase against the whole-file result (Ultra w4a8, 74 words: the 11 s and the 25 s sample;
chunks are fixed here, sound fed as fast as it can be processed):

| chunk | left | right 0.5 s | right 1 s | right 2 s |
| --- | --- | --- | --- | --- |
| 0.5 s | 1 s | 38 | 2 | 1 |
| 0.5 s | 2 s | 31 | 0 | 0 |
| 0.5 s | 3 s | 32 | 0 | 0 |
| 1 s | 1 s | 17 | 0 | 1 |
| 1 s | 2 s | 19 | 0 | 0 |
| 1 s | 3 s | 17 | 0 | 0 |
| 2 s | 1 s | 14 | 0 | 0 |
| 2 s | 2 s | 8 | 0 | 0 |
| 2 s | 3 s | 16 | 0 | 0 |

(Words that differ from the whole-file result; each whole-file result has no errors against the known text. The sound
is the phrases cut off tightly, with no silence before or after.) A right context of half a second is not enough:
the last second of a window is not judged well, and what is settled from it is wrong in a fifth of the words. One
second is enough, and a left context of one second is enough.

**Real phrases have silence round them, and that changes the answer.** With the four short sentences each given
1.2 s of silence before and 0.7 s after, as dictation hears them (word errors of the finished phrases, of 43 words):

| left | right | Ultra w4a8 | Redux w2a8 |
| --- | --- | --- | --- |
| 1 s | 1 s | 1 | 4 |
| 2 s | 1 s | 1 | 1 |
| 3 s | 1 s | 1 | 1 |
| 2 s | 1.5 s | | 0 |
| 3 s | 1.5 s | | 0 |
| 3 s | 2 s | | 0 |

Redux, whose weights are ternary, is the more fragile of the two. So `STREAM_DEFAULTS` is chunk 1 s, left 2 s, right
1.5 s: an encoder window of 4.7 s per step (with the 0.24 s lead), the smallest that gave no error for Redux. (The
first browser run with 1 s and 1 s gave Redux 4 to 5 errors in 43 words, "a lazy nod" for "the lazy dog".)

The cost of a step is a fixed part and a part in proportion to the window: about 0.6 s and 0.35 s per second of
window on one thread of this machine, for Ultra. At equilibrium the steps cover as much sound as the last step took,
so on one thread a step takes about 2 s and a word is shown between about 2 and 4 s after it was spoken. The session
measures how late the words are (`BEHIND_LIMIT`, `session.ts`: the sound waiting plus the time of the step, over 5 s
twice running, or no answer for 10 s of sound) and, if the machine cannot keep up, stops asking and writes at each
pause, with a line in the panel. The delays of the real engine are in the report of the work.

## Not confirmed

- The memory growth is measured against a browser that other browsers share the machine with; the numbers in MODELS.md are deltas, and good only to a few hundred MB.
- A person's speech in the live words: every figure is for `espeak-ng`. Redux, the more fragile model, needed more context than Ultra to be right on it.
- The live words with fewer than 8 threads (a laptop with 4 cores gets 2): between the one-thread result (it falls behind and writes at the pause) and the 8-thread one was only calculated, not run.
- Safari: `require-corp` isolation should give it threads, and WebGPU there is not available to test.
- w4a8's word error over a large sample; accuracy of a person's voice rather than `espeak-ng`.
- Anything in section 2, and the native WebGPU builds on other browsers or GPUs than the two used here.
- Phones: not tried; Tiny is the default there.
