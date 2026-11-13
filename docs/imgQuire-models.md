# imgQuire: models that could run in the browser

13 November 2026

This is research for imgQuire, not a decision. It lists models that could be fetched once into the
browser and run on ONNX Runtime Web (ORT), for each tool imgQuire might have. Every size here was read
from the repository's file listing on 13 November 2026 (Hugging Face API, `?blobs=true` or the tree API).
Sizes are in MB of 1,000,000 bytes. Licences were read from the model card metadata, the model card text
or the upstream project's licence file. Where a claim could not be checked, it says so, and the section
"Not verified" at the end collects those.

The rule followed: models may read, find, cut out, restore, upscale, denoise, remove objects and fill gaps
from the surrounding picture. Generating an image from a text prompt is ruled out. Nothing below does that.
Some models do invent detail (upscalers with a GAN, face restorers, colourisers, inpainters). Each one is
marked.

## Things that apply to every tool

**The runtime.** The site ships onnxruntime-web 1.24.1, JSEP build only (WebGPU kernels written in
JavaScript), with the plain WASM build as the fallback (see `src/quire/dictation/parakeet/RUNTIME.md`). The
latest on npm today is 1.31.1. ORT's WebGPU operator table on `main` lists most vision operators, including
Conv, ConvTranspose, Resize, GridSample (opsets 16 to 19), DFT, Einsum, InstanceNormalization,
LayerNormalization, GatherND, ScatterND and MatMulNBits. It does **not** list TopK, NonMaxSuppression,
RoiAlign, NonZero, Loop, Mod, QuantizeLinear, MatMulInteger, ConvInteger or DynamicQuantizeLinear.
Operators without a WebGPU kernel fall back to the CPU, with copies between GPU and CPU. Whether the
table for 1.24.1 matches the table on `main` is not verified.

**What precision to fetch.** Because MatMulInteger, ConvInteger and DynamicQuantizeLinear have no WebGPU
kernel, the files named `_int8` or `_quantized` (dynamic int8) mostly run on the CPU even when WebGPU is
on. For WebGPU, `_fp16` and `_q4` (MatMulNBits, 4-bit weights) are the useful ones. For WASM, `_int8` is
the useful one. Dictation found the same thing: only JSEP gave correct output for its quantized encoders.

**Big tensors on WebGPU.** One third-party rewrite of BiRefNet lite reports that the stock export does
not run on WebGPU: some shaders need more storage buffers than the 8 per shader WebGPU promises, and its
int64 index maths and `Sum` nodes have no WebGPU kernel. Expect the same with other large segmentation
graphs. Every model has to be tested on the site's own ORT build before it is offered.

**Pinning.** Every Hugging Face repository below can be pinned. The tree API gives each weight file's
SHA-256 (the `lfs.oid` field), and `resolve/<commit>/<path>` fetches the file at that commit. Small files
kept in git rather than LFS (configs, `inference.yml` dictionaries) only carry a git SHA-1, so their
SHA-256 has to be computed once by hand. GitHub release assets from before 2025 carry no digest in the
API (Real-ESRGAN's do not), so they need one download to compute it. Weights kept only on Google Drive
(MI-GAN's originals) cannot be pinned; use the Hugging Face copy.

**Gated repositories cannot be used.** A visitor's browser has no Hugging Face token, so a gated file
cannot be fetched. `briaai/RMBG-2.0` and `facebook/sam3` are gated.

**The site's licences.** The writing is CC BY-NC 4.0. The code is MIT with three conditions and public on
GitHub. Models are fetched by the visitor's browser from Hugging Face, as dictation's are, so the site does
not itself redistribute weights unless it mirrors them.

## 1. OCR (reading text)

OCR needs two models at least: a **detector** that finds text lines and gives boxes, and a **recogniser**
that reads each cropped line. A small **orientation** classifier helps with rotated lines. Boxes come from
the detector, so any detector here gives line boxes; word boxes need splitting a line by the recogniser's
character positions (CTC models give these) or a word-level detector (docTR's).

### Candidates

| Model | Repository | Licence | ONNX sizes | In the browser? | Quality |
|---|---|---|---|---|---|
| PP-OCRv6 tiny det | `PaddlePaddle/PP-OCRv6_tiny_det_onnx` | Apache-2.0 | 1.78 (fp32 only) | ORT Web not verified for v6 | Maker's own benchmark: 80.6 detection Hmean, above PP-OCRv5 mobile (75.2) |
| PP-OCRv6 tiny rec | `PaddlePaddle/PP-OCRv6_tiny_rec_onnx` | Apache-2.0 | 4.46 | not verified | 73.5 weighted accuracy, the same as PP-OCRv5 mobile (73.7); weak on handwriting (EN 39.3) |
| PP-OCRv6 small det | `PaddlePaddle/PP-OCRv6_small_det_onnx` | Apache-2.0 | 9.88 | not verified | 84.1 Hmean, above PP-OCRv5 server (81.6) |
| PP-OCRv6 small rec | `PaddlePaddle/PP-OCRv6_small_rec_onnx` | Apache-2.0 | 21.16 | not verified | 81.3; Screen 79.7, Printed EN 93.3, Handwritten EN 61.1 |
| PP-OCRv6 medium det | `PaddlePaddle/PP-OCRv6_medium_det_onnx` | Apache-2.0 | 62.03 | not verified | 86.2 Hmean |
| PP-OCRv6 medium rec | `PaddlePaddle/PP-OCRv6_medium_rec_onnx` | Apache-2.0 | 76.55 | not verified | 83.2; Screen 82.5, Printed EN 94.1, Handwritten EN 67.8 |
| PP-OCRv5 mobile det + rec | `PaddlePaddle/PP-OCRv5_mobile_det_onnx`, `..._mobile_rec_onnx` | Apache-2.0 | 4.83 + 16.53 | Yes. Three browser packages run it on ORT Web (official `@paddleocr/paddleocr-js`, `ppu-paddle-ocr`, `ffocr`); `ffocr` patches the files to work on WebGPU | 75.2 Hmean, 73.7 rec; superseded by v6 |
| PP-OCRv5 server det + rec | `PaddlePaddle/PP-OCRv5_server_det_onnx`, `..._server_rec_onnx` | Apache-2.0 | 88.12 + 84.50 | Probably (same ops as mobile), not verified | 81.6 / 78.1; v6 small beats it at a tenth of the size |
| PP-OCRv5 per-language rec | `monkt/paddleocr-onnx` (english, latin, eslav, arabic, korean, greek, thai, hindi, tamil, telugu) | Apache-2.0 | 7.8 to 13.4 each | as v5 mobile | Covers scripts the main model may not; v6 per-language files are not published by Paddle |
| PP-LCNet text line orientation | `PaddlePaddle/PP-LCNet_x1_0_textline_ori_onnx` | Apache-2.0 | 6.78 | likely, plain CNN | Turns upside-down lines the right way up |
| PP-LCNet document orientation | `PaddlePaddle/PP-LCNet_x1_0_doc_ori_onnx` | Apache-2.0 | 6.79 | likely | Detects a page rotated 90, 180 or 270 degrees |
| RapidOCR packaging | `SWHL/RapidOCR` (PP-OCR v1 to v4 as ONNX) | Apache-2.0 | v4 det 4.75, rec 10.86, server det 113.35, server rec 90.53 | as PP-OCR | Same Paddle models, older versions; no reason to prefer it now that Paddle publishes ONNX itself |
| docTR (OnnxTR) det | `Felix92/onnxtr-db-mobilenet-v3-large`, `onnxtr-fast-tiny`, `onnxtr-db-resnet50` | Apache-2.0 | 16.08, 34.11, 100.92 | Not verified on ORT Web; docTR has its own TensorFlow.js demo | Strong on documents, gives word boxes; not tuned for screenshots |
| docTR (OnnxTR) rec | `Felix92/onnxtr-crnn-mobilenet-v3-small`, `onnxtr-viptr-tiny`, `onnxtr-parseq-multilingual-v1` | Apache-2.0 | 8.33, 20.10, 96.71 | not verified | PARSeq multilingual covers Latin-script languages; no CJK |
| EasyOCR | `JaidedAI/EasyOCR` (GitHub), `qualcomm/EasyOCR` (no files on Hugging Face) | Apache-2.0 | none published; would need export | No | Older CRAFT + CRNN design; behind PP-OCR in every comparison seen |
| Tesseract (tesseract.js) | `naptha/tesseract.js`, `tesseract-ocr/tessdata_fast`, `tessdata_best` | Apache-2.0 | core WASM 3.45; `eng` fast 4.11, best 15.40 | Yes, it is built for it, but it is a second library, not ORT | Good on clean scanned pages; poor on screenshots, dark themes and photos |
| TrOCR small printed / handwritten | `Xenova/trocr-small-printed`, `Xenova/trocr-small-handwritten` | MIT (upstream `microsoft/unilm`) | encoder int8 23.08 + decoder merged int8 40.53 (fp16: 43.95 + 79.95) | Yes, transformers.js | Line recogniser only, English only; the handwritten one is trained on IAM and is good on English handwriting |
| TrOCR base | `Xenova/trocr-base-handwritten`, `...-printed` | MIT | int8 88 + 250 | Yes, but too big | Better than small; over budget |
| Surya OCR 2 / 2.5 | `datalab-to/surya-ocr-2`, `datalab-to/surya-ocr-2.5` | Code Apache-2.0; weights a modified AI Pubs OpenRAIL-M (free for research, personal use and companies under $5M) | 1,372 safetensors, no ONNX | No | Very strong document OCR with layout, in Python on a GPU |
| GOT-OCR 2.0 | `stepfun-ai/GOT-OCR2_0`; ONNX `ningpp/GOT-OCR-2.0-ONNX` | Apache-2.0 | ONNX 2,865 in all | No, far too big | Strong end-to-end OCR; no boxes by default |
| Florence-2 base | `onnx-community/Florence-2-base-ft` | MIT | q4 set about 215 (vision 81.24, encoder 30.06, decoder merged 64.39, embed int8 39.39); fp16 set about 543 | Yes, transformers.js WebGPU demo (`Xenova/florence2-webgpu`) | Has an `<OCR_WITH_REGION>` task that returns line boxes; input is fixed at 768 x 768, so small UI text in a large screenshot is lost unless tiled |
| SmolVLM 256M | `HuggingFaceTB/SmolVLM-256M-Instruct` (has `onnx/`) | Apache-2.0 | q4 set about 179 (decoder 86.56, vision 63.78, embed int8 28.39) | Yes, WebGPU demo exists | Reads text into prose; no boxes; makes things up on dense text |
| granite-docling 258M | `onnx-community/granite-docling-258M-ONNX` | Apache-2.0 | q4 set about 226 (decoder 104.72, vision 63.50, embed int8 57.80) | Yes, WebGPU demo (`ibm-granite/granite-docling-258M-WebGPU`) | Turns a page into structured text with tables and layout; documents, not screenshots |
| moondream2 | `Xenova/moondream2` | Apache-2.0 | q4 set about 1,200 | WebGPU demo exists, but far over budget | Good captions and reading; too big |
| PaddleOCR-VL 1.5 | `onnx-community/PaddleOCR-VL-1.5-ONNX` | Apache-2.0 | q4 set about 890 | not verified, too big | Top document parser; too big |
| LightOnOCR 2 1B | `onnx-community/LightOnOCR-2-1B-ONNX` | Apache-2.0 | q4 set about 755 | not verified, too big | Strong; too big |
| LFM2.5-VL 450M | `LiquidAI/LFM2.5-VL-450M-ONNX` | LFM Open License 1.0 | q4 set about 675 | WebGPU demo exists | Its own card says it is "not well-suited for ... fine-grained OCR" |

**Layout and tables.**

| Model | Repository | Licence | ONNX size | Notes |
|---|---|---|---|---|
| OnnxTR table detector | `Felix92/onnxtr-tablecenternet` | Apache-2.0 | 29.37 | Finds tables; quality not verified |
| OnnxTR layout | `Felix92/onnxtr-lw-detr-s` | Apache-2.0 | 47.30 | Small layout detector; classes not verified |
| Table Transformer (detection, structure) | `Xenova/table-transformer-detection`, `Xenova/table-transformer-structure-recognition-v1.1-all` | MIT upstream (`microsoft/table-transformer`); not stated on the Xenova copies | int8 30.04 each, fp16 58.23 | transformers.js; DETR, so slow per image |
| PP-DocLayout S | `PaddlePaddle/PP-DocLayout-S` | Apache-2.0 | 4.80 Paddle format, no ONNX published | Would need export with paddle2onnx |
| PP-DocLayout plus L | `PaddlePaddle/PP-DocLayout_plus-L_onnx` | Apache-2.0 | 129.74 | 20 region classes; RT-DETR |
| PP-DocLayoutV3 | `Bei0001/PP-DocLayoutV3-ONNX` (third party) | Apache-2.0 | 141.86 | Newest Paddle layout model |
| Docling layout Heron | `docling-project/docling-layout-heron-onnx` | Apache-2.0 | 171.22 | RT-DETRv2; strong on documents |

### Recommendation

The clear choice is **PP-OCRv6**. It came out on 11 June 2026, its official repositories ship ONNX, it is
Apache-2.0, and its three tiers fall almost exactly on the three sizes asked for. Its own benchmark has a
"Screen" category (UI text), and medium and small beat PP-OCRv5 server on it by a wide margin (82.5 and
79.7 against 68.1). Those figures are the maker's own and not independently checked. The v5 models are
known to run on ORT Web, and v6 uses ordinary convolution blocks, but v6 on the site's ORT build is not
verified. That is the first thing to test.

| Size | Files | Total | Why |
|---|---|---|---|
| Small | v6 tiny det + v6 tiny rec | 6.2 MB | Detection as good as v5 mobile at a third of the size; reading as good as v5 mobile. Enough to find names and tokens in a clear screenshot |
| Medium | v6 small det + v6 small rec + text line orientation | 37.8 MB | The best value. Beats v5 server. Handles rotated lines |
| Large | v6 medium det + v6 medium rec + text line and document orientation | 152.2 MB | Best open small OCR seen. Handwriting is better (67.8 on English handwriting), though still not good |

Add-ons worth offering separately:

- **English handwriting:** TrOCR small handwritten, int8, 63.6 MB, run on lines PP-OCRv6 has found.
- **Scripts v6 may not cover** (Cyrillic, Arabic, Devanagari, Korean and others): the PP-OCRv5 per-language
  recognisers in `monkt/paddleocr-onnx`, 7.8 to 13.4 MB each, behind the same detector.
- **Tables:** `Felix92/onnxtr-tablecenternet` at 29.4 MB.
- **Describing a whole page as structured text:** granite-docling, about 226 MB, as a separate "read this
  document" tool. It gives no boxes, so it cannot drive hiding or selection.

Not recommended: Tesseract (it is a second library, and it is weak on screenshots); Surya, GOT-OCR,
PaddleOCR-VL and LightOnOCR (far too big for a browser); SmolVLM and moondream for OCR (no boxes, and they
invent text).

## 2. Background removal and subject cut-out

### Candidates

| Model | Repository | Licence | ONNX sizes | In the browser? | Quality |
|---|---|---|---|---|---|
| U2-Net small (u2netp) | `BritishWerewolf/U-2-Netp` | Apache-2.0 | 4.57 (fp32) | likely, plain CNN at 320 x 320 | Rough edges; the old baseline |
| U2-Net | `BritishWerewolf/U-2-Net` | Apache-2.0 | 176.00 | likely | Superseded by ISNet at the same size |
| MODNet | `Xenova/modnet` | Apache-2.0 | fp32 25.89, fp16 12.98, int8 6.63 | Yes, `webml-community/remove-background-webgpu` uses it | Portraits only; fast; soft hair edges |
| MediaPipe selfie segmentation | `onnx-community/mediapipe_selfie_segmentation` | Apache-2.0 | 0.46 | likely | People only, low resolution; for a blur, not a cut-out |
| ISNet (DIS) general | `imgly/isnet-general-onnx` (MIT on the card); `onnx-community/ISNet-ONNX` (AGPL-3.0 on the card) | Upstream `xuebinqin/DIS` is Apache-2.0 | fp32 176.15, fp16 88.15; int8 44.31 in the onnx-community copy | likely, same graph family as RMBG-1.4 | Good general objects; RMBG-1.4 is this network retrained |
| ormbg | `onnx-community/ormbg-ONNX` | Apache-2.0 | fp32 176.12, fp16 88.12, int8 44.32 | Yes, transformers.js | ISNet trained on synthetic people; good on people, weaker on objects |
| RMBG-1.4 (BRIA) | `briaai/RMBG-1.4` | BRIA RMBG 1.4 licence: "source-available model for non-commercial use" | fp32 176.15, fp16 88.22, int8 44.40 | Yes, `Xenova/remove-background-webgpu` uses it | Clearly better than ISNet on mixed images in BRIA's own comparison |
| RMBG-2.0 (BRIA) | `briaai/RMBG-2.0` | CC BY-NC 4.0, **gated** | fp32 1,024, fp16 513.58, int8 366.09 | No: gated, and too big | Strong (BiRefNet trained on BRIA data) |
| BiRefNet lite | `onnx-community/BiRefNet_lite-ONNX`; WebGPU rewrite `wonfy/BiRefNet_lite-ONNX-webgpu`; 512 x 512 version `shozebDev/birefnet-lite-512-onnx` | MIT | stock fp16 114.54; rewrite fp16 123.21; 512 fp16 98.45 | The stock export does not run on WebGPU (see above); the rewrite is reported to | Very clean edges at 1024 x 1024; the best open option near this size |
| BiRefNet (full) | `onnx-community/BiRefNet-ONNX`, `...-portrait-ONNX`; matting `ZhengPeng7/BiRefNet-matting`, `ZhengPeng7/BiRefNet_HR-matting` | MIT | fp16 489.67 | Too big | State of the art on DIS5K; too big |
| BEN2 base | `onnx-community/BEN2-ONNX`, `PramaLLC/BEN2` | MIT | fp16 219.12 (fp32 222.93 in PramaLLC) | transformers.js copy exists; WebGPU not verified | Maker reports better hair and edges than BiRefNet; maker's claim |
| InSPyReNet SwinB | `OS-Software/InSPyReNet-SwinB-Plus-Ultra-ONNX` | MIT | fp32 395.32, fp16 199.13 | not verified | Excellent edges at high resolution; heavy |

**Click to select (a point or a box picks the object).**

| Model | Repository | Licence | ONNX sizes (encoder + decoder) | In the browser? | Quality |
|---|---|---|---|---|---|
| SlimSAM 77 | `Xenova/slimsam-77-uniform` | Apache-2.0 | int8 8.88 + 4.90; fp16 12.17 + 8.55 | Yes, `Xenova/segment-anything-webgpu` | SAM pruned to 1.4 percent; masks are coarser than SAM but usable |
| SlimSAM 50 | `Xenova/slimsam-50-uniform` | Apache-2.0 | int8 30.07 + 4.90; fp16 48.65 + 8.55 | Yes | Better than 77 |
| MobileSAM | `PulpCut/mobilesam-onnx` (third party) | Apache-2.0 upstream | 28.20 + 16.51 (8.84 quantized) | Widely used in browsers with ORT Web; this copy not verified | About as good as the original SAM on single objects |
| EdgeSAM | `chongzhou/EdgeSAM` | S-Lab License 1.0, non-commercial | 22.10 + 15.94 | not verified | Better than MobileSAM per its paper |
| SAM 2.1 tiny | `onnx-community/sam2.1-hiera-tiny-ONNX` | Apache-2.0 upstream (`facebookresearch/sam2`); not stated on the copy | q4 43.76 + 7.13; int8 52.57 + 8.66; fp16 67.01 + 10.45 | transformers.js | Clearly better masks than SAM 1 and its small copies |
| SAM 2.1 small / base plus | `onnx-community/sam2.1-hiera-small-ONNX`, `...-base-plus-ONNX` | Apache-2.0 upstream | small q4 48.26 + 7.13; base plus q4 74.62 + 7.13, fp16 152.78 + 10.45 | transformers.js | Better again |
| SAM 3 tracker | `onnx-community/sam3-tracker-ONNX` | SAM License (custom), upstream is gated | q4 368.95 + 8.24 | Too big | Too big |

**Hair and fine edges (matting).**

| Model | Repository | Licence | ONNX sizes | Notes |
|---|---|---|---|---|
| ViTMatte small | `Xenova/vitmatte-small-composition-1k`, `...-distinctions-646` | MIT upstream (`hustvl/ViTMatte`); the HF original is tagged Apache-2.0 | fp32 103.89, int8 27.50 | Needs a trimap (sure, unsure, background), which can be made from a SAM or BiRefNet mask. Composition-1k is built from the Adobe matting set, whose own terms are research-only; whether that reaches the weights is not settled |
| BiRefNet matting | `ZhengPeng7/BiRefNet_HR-matting` | MIT | 444.47 safetensors, no ONNX | Too big |

### Recommendation

| Size | Model | Total | Why |
|---|---|---|---|
| Small | MODNet fp16 for people, plus SlimSAM 77 int8 for clicking on anything | 13.0 + 13.8 = 26.8 MB (or 6.6 MB MODNet int8 alone) | Nothing small cuts out general objects well. MODNet does people; SlimSAM lets her click the object she means |
| Medium | ormbg int8 for one-press removal, plus SAM 2.1 tiny q4 for clicking | 44.3 + 50.9 = 95.2 MB, or either alone at about 50 | ormbg is Apache and good on people; SAM 2.1 tiny gives clean masks on anything she points at. RMBG-1.4 is better but its licence is BRIA's non-commercial one |
| Large | BiRefNet lite fp16 (the WebGPU rewrite, or the 512 x 512 version at 98 MB) | 123.2 MB | MIT, and edges are clearly better than anything smaller. Pair with ViTMatte small int8 (27.5 MB) for hair if needed |

BEN2 (219 MB, MIT) and InSPyReNet (199 MB, MIT) are the choices just over the large size.

## 3. Upscaling and restoration

Upscalers trained with a GAN invent texture that was not in the picture. Those trained for PSNR (plain
fidelity) invent much less and look softer. Each row says which.

### Candidates

| Model | Repository | Licence | ONNX sizes | In the browser? | Invents? | Quality |
|---|---|---|---|---|---|---|
| Real-ESRGAN general x4v3 (SRVGG compact) | weights: GitHub release `v0.2.5.0/realesr-general-x4v3.pth` (4.89); ONNX copies `TheGuy444/Real-ESRGAN-ONNX` (4.84), `xrds/realesrgan-x4v3-fixed` (int8 4.87) | BSD-3-Clause | about 4.9 | Likely (plain conv + PixelShuffle); these copies not verified | GAN, mild | The usual small real-photo upscaler; there is also a `wdn` version with a denoise strength |
| Real-ESRGAN x4plus | `imgdesignart/realesrgan-x4-onnx`; `lxfater/inpaint-web/realesrgan-x4.onnx` | BSD-3-Clause upstream; the copies state none or GPL-3.0 (inpaint-web) | fp32 67.05, fp16 33.75 | Yes, inpaint-web runs it with ORT Web, WebGPU or WASM | GAN, strong | Sharp, sometimes painterly; the reference most others compare to |
| Real-ESRGAN x4plus anime 6B | GitHub release `RealESRGAN_x4plus_anime_6B.pth` (17.94) | BSD-3-Clause | needs export, about 18 | not verified | GAN | For drawings and anime |
| Swin2SR lightweight x2 | `Xenova/swin2SR-lightweight-x2-64` | Apache-2.0 (upstream `mv-lab/swin2sr`) | fp32 8.08, fp16 7.52, q4 5.68 | Yes, transformers.js | No (PSNR) | Clean 2x for clean pictures |
| Swin2SR real-world x4 | `Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr` | Apache-2.0 | fp32 52.77, fp16 32.36, int8 21.44 | Yes, transformers.js | Little (PSNR) | Honest 4x for real photos; softer than Real-ESRGAN |
| Swin2SR compressed x4 | `Xenova/swin2SR-compressed-sr-x4-48` | Apache-2.0 | fp16 32.74, int8 21.64 | Yes | Little | Trained on JPEG-damaged input; good on screenshots that were recompressed |
| Swin2SR classical x2 | `Xenova/swin2SR-classical-sr-x2-64` | Apache-2.0 | fp16 32.43, int8 21.47 | Yes | No | Best fidelity of the Swin2SR set on clean input |
| RealPLKSR x2 / x4 | `darktable-org/upscale-realplksr-onnx` | MIT | 29.63 / 29.71 | not verified in browsers; darktable chose it for its own upscaler | Mild | Modern, fast pure-conv design; a good middle choice |
| APISR | `Xenova/4x_APISR_GRL_GAN_generator-onnx`, `Xenova/2x_APISR_RRDB_GAN_generator-onnx` | **GPL-3.0** | 4x: fp32 6.49, fp16 5.21; 2x: fp16 9.03 | Yes, transformers.js | GAN | Anime only |
| waifu2x (nunif) | `deepghs/waifu2x_onnx` (CUNet 5.2, Swin-UNet 16.8 to 19.0 per file); `nunif/waifu2x` zips | MIT upstream (`nagadomi/nunif`); the `nunif/waifu2x` HF copy is tagged AGPL-3.0 | 5.2 to 19.0 | Yes, the official waifu2x site runs these ONNX files in the browser | Little | Excellent for drawings and art scans, with noise levels 0 to 3; has a "photo" Swin-UNet too |
| Real-CUGAN | `bilibili/ailab` | MIT | needs export (from ncnn or PyTorch) | not verified | GAN | Anime |
| SPAN, OmniSR, DAT light | `hongyuanyu/SPAN` (Apache-2.0); `Acly/Omni-SR` (Apache-2.0, 1.7 safetensors); `zhengchen1999/DAT` (Apache-2.0) | as listed | no ONNX published; would need export | not verified | No (these weights are PSNR) | Small and accurate on clean input; not trained for real-world damage |
| SwinIR | `Heliosoph/swinir-onnx` (realSR x4 121.76, denoise 54.86); `rocca/swin-ir-onnx` (61.32) | Apache-2.0 | as listed | `rocca` built it for a browser demo; not verified on current ORT | GAN (realSR) | Good, but Swin2SR is its successor |
| HAT real GAN | `MahoCommerce/Real_HAT_GAN_sharper-ONNX` | Apache-2.0 (upstream `XPixelGroup/HAT`) | 161.11 | not verified; attention at this size will be slow | GAN | Among the best real-world upscalers in benchmarks |
| ESPCN, FSRCNN | OpenCV `dnn_superres` models (GitHub) | Apache-2.0 (OpenCV) | under 0.1 | likely | No | Barely better than a good resize; not worth a download |

**Denoise, deblur, JPEG repair.**

| Model | Repository | Licence | ONNX size | Notes |
|---|---|---|---|---|
| SCUNet | `Heliosoph/scunet-onnx` (colour 15, 25, 50, real PSNR, real GAN; grey) | Apache-2.0 | 3.80 graph + 73.14 data each | Strong blind denoiser for real photos; the "real PSNR" one invents least |
| NAFNet deblur | `opencv/deblurring_nafnet` | MIT | 91.74 | Motion deblur (GoPro); not verified in browsers |
| NAFNet denoise | `qualcomm/NAFNet-DeNoise` (no files on Hugging Face), `litert-community/NAFNet-SIDD-width32-LiteRT` | MIT | width32 needs export | Excellent on the SIDD phone-noise benchmark |
| Restormer | `swz30/Restormer` | MIT | no ONNX found; would need export | Strong but heavy (26M parameters); attention over channels exports cleanly in principle |
| FBCNN | `jiaxi-jiang/FBCNN` | Apache-2.0 | no ONNX found; would need export | Built for JPEG artifacts, with a quality knob; size of the export not verified |
| SwinIR denoise | `Heliosoph/swinir-onnx` | Apache-2.0 | 54.86 | Fixed noise level 25 |

**Face restoration.** These do cross into inventing. They draw a plausible face from a prior learned on
thousands of faces, so eyes, teeth and skin are made up, and the result can look like someone else.

| Model | Repository | Licence | ONNX sizes | Notes |
|---|---|---|---|---|
| GFPGAN 1.4 | `netrunner-exe/Face-Upscalers-onnx`, `Meeperomi/GFPGANv1.4-onnx` | Apache-2.0 with listed third-party parts (upstream `TencentARC/GFPGAN`) | fp32 340.26, fp16 170.26 | Over budget; strong invention |
| RestoreFormer | `netrunner-exe/Face-Upscalers-onnx` | Apache-2.0 (RestoreFormer++ upstream) | fp16 146.22 | Same caution |
| CodeFormer | `yuvraj108c/codeformer-onnx`, `netrunner-exe/Face-Upscalers-onnx` | **S-Lab License 1.0, non-commercial** | fp32 337.17 to 376.80, fp16 188.58 | Has a fidelity dial, but still invents |
| GPEN | `netrunner-exe/Face-Upscalers-onnx` | No licence file upstream; the author withdrew models "due to commercial issues" | 256: fp16 38.03; 512: fp16 142.33 | Licence unclear; avoid |

### Recommendation

| Size | Model | Total | Why |
|---|---|---|---|
| Small | Real-ESRGAN general x4v3 for photos (4.9 MB), Swin2SR lightweight x2 for a faithful 2x (7.5 MB), waifu2x CUNet for art (5.2 MB) | 17.6 MB for all three, or about 5 each | Each is tiny. The ESRGAN one invents a little; the other two hardly at all |
| Medium | Swin2SR real-world x4 fp16 (32.4 MB) as the honest default, RealPLKSR x4 (29.7 MB) or Real-ESRGAN x4plus fp16 (33.8 MB) as the sharp one, SCUNet real PSNR (77 MB) as the denoiser | 32 to 110 MB | Gives her a choice between faithful and sharp, and a real denoiser |
| Large | HAT real GAN (161 MB) for upscaling, or Swin2SR compressed x4 plus SCUNet for damaged screenshots and photos | about 110 to 160 MB | HAT is the strongest real-world upscaler with an Apache licence and an ONNX file. Its speed in a browser is the open question |

Face restoration is not recommended for the first version. It invents faces and the good ones are either
over 150 MB or non-commercial.

## 4. Removing objects and filling gaps (inpainting, no text prompt)

| Model | Repository | Licence | ONNX size | In the browser? | Resolution | Quality |
|---|---|---|---|---|---|---|
| MI-GAN 512 Places2 | `andraniksargsyan/migan` (`migan_pipeline_v2.onnx` 28.08, `migan.onnx` 29.55); `anyisalin/migan-onnx` | MIT (code and weights, Picsart) | 28.1 | **Yes.** Built for mobile and web; `inpaint-web` runs it in the browser on ORT Web, WebGPU or WASM | The pipeline file takes any size, crops around the mask, works at 512 x 512 and blends back | Close to LaMa on Places2 at a fraction of the size, per its ICCV 2023 paper; best for small and medium holes |
| LaMa (big-lama) | `Carve/LaMa-ONNX` (`lama_fp32.onnx` 208.04); `anyisalin/big-lama-onnx` (207.48); `smile-forge/big-lama-onnx` (208.85) | Apache-2.0 | 208 | Not verified on ORT Web. Uses DFT (opset 17), which is on ORT's WebGPU list | Carve's export is fixed at 512 x 512; other sizes need re-export | The reference for large holes and repeating texture (fences, brick, tiles) |
| LaMa (OpenCV) | `opencv/inpainting_lama` | Apache-2.0 | 92.59 | not verified | not verified | The OpenCV card names Carve's fp32 file as its source, but the file is under half the size; what changed is not verified |
| AOT-GAN | `Liiesl/aot-inpainting-onnx` | not stated | 23.07 | not verified | not verified | Older; licence unknown |
| MAT | `fenglinglwb/MAT` | **CC BY-NC 4.0** | no ONNX | No | 512 | Good on large holes; too heavy and non-commercial |
| ZITS | `DQiaole/ZITS_inpainting` | Apache-2.0 | no ONNX; several networks | No | | Good on buildings and lines; too complex to port |

Tiling: neither model needs tiling in the usual sense. Both work on a crop around the mask, resized to
512 x 512, and the result is blended back at full resolution. For a large hole in a large picture, the crop
is scaled down, so the fill is soft; the MI-GAN authors suggest small strokes for large areas.

### Recommendation

| Size | Model | Total | Why |
|---|---|---|---|
| Small | MI-GAN pipeline | 28.1 MB | MIT, proven in a browser, handles crop and blend itself |
| Medium | MI-GAN pipeline | 28.1 MB | There is no good model between 30 and 200 MB. The OpenCV LaMa file at 92.6 MB might be one, if testing shows it is LaMa unchanged |
| Large | LaMa big-lama fp32 (Carve) | 208 MB | Best open fill for large holes and textures. Just over the size; an fp16 export would be about 104 MB (not published) |

## 5. Understanding a picture

A useful trick for tagging: zero-shot models (CLIP, SigLIP) need a text tower to turn words into
vectors, and the text tower is the big half. If the list of tags is fixed, the text vectors can be worked
out once ahead of time and shipped as a small table, so only the vision tower is downloaded.

### Candidates

| Job | Model | Repository | Licence | ONNX sizes | In the browser? | Quality |
|---|---|---|---|---|---|---|
| Classify (1,000 ImageNet classes) | MobileNetV4 conv small | `onnx-community/mobilenetv4_conv_small.e2400_r224_in1k` | Apache-2.0 (timm); not stated on the copy | fp32 15.09, fp16 7.56, int8 3.93 | Yes, transformers.js | 73.8 percent top-1 on ImageNet (timm); ImageNet classes are odd for real use |
| Classify | MobileNetV4 conv medium | `onnx-community/mobilenetv4_conv_medium.e500_r256_in1k` | Apache-2.0 | fp16 19.43, int8 10.00 | Yes | About 80 percent top-1 |
| Zero-shot tags | SigLIP 2 base 224 | `onnx-community/siglip2-base-patch16-224-ONNX` | Apache-2.0 (upstream `google-research/big_vision`) | vision q4 63.27, fp16 186.04, int8 94.55; text int8 283.44 | Yes, transformers.js | The best open zero-shot family; with precomputed tag vectors only the vision part is needed |
| Zero-shot tags | CLIP ViT-B/32 | `onnx-community/clip-vit-base-patch32-ONNX` | MIT | whole model int8 153.48, q4 189.45 | Yes | Older and weaker than SigLIP 2 |
| Zero-shot tags | MobileCLIP S0 / S2 | `Xenova/mobileclip_s0`, `Xenova/mobileclip_s2` | **Apple ML Research licence: "for the sole purpose of scientific research"** | S0 vision int8 11.85, text int8 42.80 | Yes | Very good for its size, but research-only |
| Tagging | RAM++ | `xinyu1205/recognize-anything-plus-model` | Apache-2.0 | 3,010 PyTorch, no ONNX | No | 4,585 tags, strong; far too big |
| Tagging (anime only) | WD SwinV2 tagger v3 | `SmilingWolf/wd-swinv2-tagger-v3` | Apache-2.0 | 467.46, quint8 170.42 (third party) | likely | Only for drawings |
| Objects (80 COCO classes) | D-FINE nano | `onnx-community/dfine_n_coco-ONNX` | Apache-2.0 (upstream `Peterande/D-FINE`) | fp32 15.26, fp16 7.87, int8 4.48 | Yes, transformers.js | 42.8 AP on COCO (paper), better than YOLO nano models |
| Objects (365 classes) | D-FINE small Objects365 | `onnx-community/dfine_s_obj365-ONNX` | Apache-2.0 | fp16 21.34, int8 11.33 | Yes | Many more everyday classes |
| Objects | RF-DETR nano / small / medium | `onnx-community/rfdetr_nano-ONNX`, `..._small-ONNX`, `..._medium-ONNX` | Apache-2.0 | nano q4 25.04, fp16 54.36; medium fp16 60.86 | Yes, transformers.js | Highest COCO AP in this size class at release (Roboflow's figures) |
| Objects | RT-DETR v2 r18 | `onnx-community/rtdetr_v2_r18vd-ONNX` | Apache-2.0 | fp16 40.75, int8 20.99 | Yes | Good; D-FINE and RF-DETR beat it |
| Objects | YOLOv10, YOLO11, YOLO26 | `onnx-community/yolov10n`, `onnx-community/yolo26n-ONNX` | **AGPL-3.0** | fp16 4.74 to 4.98 | Yes | Good, but see licences below |
| Objects by name | OWLv2, Grounding DINO tiny | `onnx-community/owlv2-base-patch16-ensemble-ONNX`, `onnx-community/grounding-dino-tiny-ONNX` | Apache-2.0 | int8 163.17; int8 203.82 | Yes | Finds anything named in words; slow and big |
| Faces | YuNet | `opencv/face_detection_yunet` | MIT (OpenCV zoo) | 0.23, int8 0.10 | likely, tiny CNN | Fast and good to about 10 px faces; made for this |
| Faces | BlazeFace | `garavv/blazeface-onnx` (third party) | Apache-2.0 upstream (MediaPipe); copy not stated | 0.54 | likely | Made for near selfie faces; misses small faces in crowds |
| Faces | SCRFD | `immich-app/scrfd_34g_gnkps` and others | Code MIT; **models "for non-commercial research purposes only"** (insightface) | 0.6 to 17 | likely | Best accuracy, licence restricted |
| Caption | Florence-2 base | `onnx-community/Florence-2-base` | MIT | q4 set about 215 | Yes, WebGPU demo | Captions at three lengths, object detection, OCR with regions, in one model |
| Caption | SmolVLM 256M | `HuggingFaceTB/SmolVLM-256M-Instruct` | Apache-2.0 | q4 set about 179 | Yes | Answers questions about a picture; sometimes wrong |
| Caption | ViT-GPT2 | `Xenova/vit-gpt2-image-captioning` | Apache-2.0 | int8 87.45 + 158.60 | Yes | Old and generic |
| Caption | BLIP base | `ningpp/blip-image-captioning-base-ONNX` | BSD-3-Clause | 990 | Too big | |
| Caption | moondream2 | `Xenova/moondream2` | Apache-2.0 | q4 set about 1,200 | WebGPU demo | Too big |
| NSFW | Marqo NSFW 384 | `Marqo/nsfw-image-detection-384` | Apache-2.0 | 22.40 safetensors; no ONNX found | would need export (timm ViT tiny) | Maker reports 98.6 percent on its test set |
| NSFW | NSFWJS | `Sunxyw/nsfwjs-onnx` (third party) | MIT upstream (`infinitered/nsfwjs`) | int8 17.32 | likely | Five classes (drawing, hentai, neutral, porn, sexy); older |
| NSFW | ViT base detectors | `AdamCodd/vit-base-nsfw-detector` (has `onnx/`), `onnx-community/nsfw_image_detection-ONNX` (Falconsai) | Apache-2.0 | q4 57.93, int8 88.50 | Yes | Good, but four times bigger than Marqo |
| Depth | Depth Anything V2 small | `onnx-community/depth-anything-v2-small` | Apache-2.0 | fp32 99.06, fp16 49.64, int8 27.26 | Yes, transformers.js WebGPU demos | Fine relative depth; enough for a background blur |
| Depth | Depth Anything V3 small | `onnx-community/depth-anything-v3-small` | Apache-2.0 | 0.64 + 104.70 data (fp32 only) | not verified | Newer; base and large of both versions are bigger, and V2 base and large are CC BY-NC |
| Depth | Depth Pro | `onnx-community/DepthPro-ONNX` | Apple sample code licence | q4 746 | Too big | |

### Recommendation

| Size | Models | Total | Why |
|---|---|---|---|
| Small | YuNet (faces, 0.2 MB), D-FINE nano int8 (objects, 4.5 MB), MobileNetV4 small int8 (3.9 MB) | 8.6 MB | Finds faces to blur and common objects, all Apache or MIT |
| Medium | YuNet, D-FINE small Objects365 fp16 (21.3 MB), Depth Anything V2 small int8 (27.3 MB), Marqo NSFW once exported (about 22 MB) | about 71 MB | Adds depth for background blur, 365 object classes, and a safety check |
| Large | Florence-2 base q4 (about 215 MB), plus YuNet | about 215 MB | One model gives captions, object boxes and a second OCR. Or SigLIP 2 vision q4 (63 MB) with a precomputed tag table, plus the medium set, at about 140 MB |

## 6. Colour and light

Most of this is better done without a model: grey-world or white-patch white balance, histogram
stretching and curves are exact, instant and invent nothing. The models below are the exceptions.

| Job | Model | Repository | Licence | Size | Notes |
|---|---|---|---|---|---|
| White balance | Deep White Balance | `mahmoudnafifi/Deep_White_Balance` | **CC BY-NC-SA 4.0** | PyTorch only, would need export | Fixes and changes white balance on sRGB pictures; non-commercial and share-alike |
| Low light | Zero-DCE | `mlboydaisuke/zero-dce-litert` (TFLite 0.34) | **Non-commercial** ("for non-commercial use only", and CC BY-NC 4.0 for Zero-DCE++) | under 1 MB; needs ONNX export | Tiny curve estimator; brightens dark photos without inventing |
| Low light | Retinexformer | `CaiYuanhao/Retinexformer` | MIT (upstream code) | 6.48 PyTorch per checkpoint; needs export | Stronger than Zero-DCE on the LOL benchmarks; licence of the Hugging Face copy not stated |
| Colourise | DDColor | `piddnad/ddcolor_paper_tiny` (220.37 PyTorch), `piddnad/ddcolor_modelscope`, `piddnad/ddcolor_artistic` (911.91 each); ONNX `Diogo122333/ddcolor-512-fp16` (456.54, third party) | Apache-2.0 | tiny needs export, about 110 at fp16 (estimate) | Best open colouriser. **It invents colour** |
| Colourise | DeOldify | `xrds/deoldify` (int8 64.02, third party) | MIT upstream (`jantic/DeOldify`) | 64 | Older, browner. **Invents colour** |

### Recommendation

| Size | Model | Why |
|---|---|---|
| Small | No model. Classical white balance, auto levels and curves | Exact and free; nothing small and freely licensed does better |
| Medium | Retinexformer for low light, once exported (about 7 MB) | MIT, small, does not invent |
| Large | DDColor tiny, exported to fp16 (about 110 MB, estimate) | Only if colourising is wanted; it should be labelled as invented colour |

## Licences that are a problem

- **AGPL-3.0 (YOLOv8, YOLO11, YOLO26 by Ultralytics; YOLOv10 by THU).** Ultralytics treats its weights as
  AGPL and says any software that uses them must be released under AGPL. The site's code is MIT, and
  running the model in the visitor's browser is close to the network-use case AGPL was written for.
  D-FINE and RF-DETR are Apache-2.0 and as good or better, so there is no reason to take the risk.
- **AGPL tag on `onnx-community/ISNet-ONNX`.** The upstream DIS weights are Apache-2.0, and
  `imgly/isnet-general-onnx` says MIT. Use the upstream weights or export them, not that copy.
- **AGPL tag on `nunif/waifu2x`.** The upstream project is MIT. Use upstream or `deepghs/waifu2x_onnx`,
  and check the zip's own licence file before use.
- **GPL-3.0 (APISR, and `lxfater/inpaint-web`).** Using GPL weights inside MIT code is unclear. APISR is only
  for anime, so it can be left out. The Real-ESRGAN file in inpaint-web is BSD upstream; take it from
  upstream, not from that repository.
- **BRIA RMBG-1.4.** BRIA calls it a "source-available model for non-commercial use" under its own
  agreement. A free personal site looks like non-commercial use, but the agreement page it links to
  returned 404 on 13 November 2026, so the exact terms could not be read.
- **BRIA RMBG-2.0.** CC BY-NC 4.0, and gated behind a form that asks for name, email and company. A
  visitor's browser cannot fetch it. Unusable.
- **CC BY-NC (MAT, Depth Anything V2 base and large, Zero-DCE++) and CC BY-NC-SA (Deep White Balance).**
  These match the site's own CC BY-NC content, and a free site is non-commercial. But the code is MIT, so
  anyone who copies the site for a commercial use would lose these models. Share-alike adds a condition on
  anything made from the model.
- **S-Lab License 1.0 (CodeFormer, EdgeSAM).** Non-commercial redistribution only, with notice. Same
  situation as CC BY-NC.
- **Research only (Apple MobileCLIP and FastVLM, the Apple ML Research licence; insightface models such as
  SCRFD; Zero-DCE).** "Research" is narrower than "non-commercial"; a public editor is not research. Avoid.
- **Modified OpenRAIL-M (Surya).** Free for personal use and small companies, with use restrictions. Too big
  for a browser anyway.
- **LFM Open License 1.0 (LiquidAI).** Free below a revenue line; not needed, since its own card says it is
  weak at OCR.
- **SAM License (SAM 3).** Custom and gated. SAM 2.1 is Apache-2.0 and is the one to use.
- **No licence stated** on several third-party copies (`imgdesignart/realesrgan-x4-onnx`,
  `anyisalin/big-lama-onnx`, `anyisalin/migan-onnx`, `opencv/inpainting_lama`, `PulpCut/mobilesam-onnx`,
  `onnx-community/sam2.1-*`, `onnx-community/dfine_*`, `Liiesl/aot-inpainting-onnx`). Where the upstream
  is clearly licensed, the upstream licence carries over to a straight conversion, but the safest course
  is to export from upstream weights or use the copy that states its licence.
- **Training data.** ViTMatte's Composition-1k weights come from the Adobe matting dataset, whose terms are
  research-only. Whether that reaches the weights is unsettled.

## Not verified

- Whether PP-OCRv6 (any tier) runs on ORT Web, on WebGPU or WASM, and on the site's 1.24.1 build. PP-OCRv5
  is known to run; `ffocr` had to patch v5 for WebGPU, and what it patched is not documented.
- Which languages PP-OCRv6's single recogniser covers. Its cards say both 50 and 48 languages and do not
  list them. Third-party Cyrillic fine-tunes of v6 suggest Cyrillic is not covered well.
- PP-OCRv6's accuracy figures are the maker's own in-house benchmark. No independent comparison was found.
- Whether ORT's WebGPU operator table on `main` matches 1.24.1.
- Speed in a browser for almost every model. No trustworthy published figures were found. Only the
  existence of working browser demos was checked (Florence-2, SmolVLM, granite-docling, moondream,
  SlimSAM, MODNet, RMBG-1.4, Depth Anything, MI-GAN and Real-ESRGAN in inpaint-web).
- Whether LaMa runs on ORT Web at all (it needs DFT), and what `opencv/inpainting_lama` (92.6 MB) changed
  from Carve's 208 MB file.
- Whether the stock `onnx-community/BiRefNet_lite-ONNX` fails on WebGPU. The claim comes from the author of
  `wonfy/BiRefNet_lite-ONNX-webgpu`, a single third party.
- BEN2's and InSPyReNet's ONNX files on WebGPU.
- The ONNX size of FBCNN, NAFNet width32, Restormer, Marqo NSFW and DDColor tiny once exported. The DDColor
  figure above is an estimate (half the PyTorch file at fp16).
- Whether docTR's ONNX files (OnnxTR) run on ORT Web.
- BRIA's RMBG-1.4 agreement text (the linked page returned 404).
- Speed of HAT and the Swin-based upscalers on WebGPU at useful sizes.
- Which ImageNet top-1 figures apply to the exact MobileNetV4 checkpoints (taken from timm's tables, not
  re-measured).

## Sources

Hugging Face model listings and cards (all at `https://huggingface.co/<id>`, sizes from
`https://huggingface.co/api/models/<id>?blobs=true` and `https://huggingface.co/api/models/<id>/tree/main`):

- PaddlePaddle/PP-OCRv6_tiny_det_onnx, PP-OCRv6_tiny_rec_onnx, PP-OCRv6_small_det_onnx,
  PP-OCRv6_small_rec_onnx, PP-OCRv6_medium_det_onnx, PP-OCRv6_medium_rec_onnx, PP-OCRv5_mobile_det_onnx,
  PP-OCRv5_mobile_rec_onnx, PP-OCRv5_server_det_onnx, PP-OCRv5_server_rec_onnx,
  PP-LCNet_x1_0_doc_ori_onnx, PP-LCNet_x1_0_textline_ori_onnx, PP-DocLayout-S, PP-DocLayout_plus-L_onnx,
  PP-DocLayoutV2_onnx, PaddleOCR-VL-1.6
- monkt/paddleocr-onnx, SWHL/RapidOCR, webnn/PP-OCRv5-ONNX, Bei0001/PP-DocLayoutV3-ONNX,
  docling-project/docling-layout-heron-onnx
- Felix92/onnxtr-db-mobilenet-v3-large, onnxtr-fast-tiny, onnxtr-fast-base, onnxtr-db-resnet50,
  onnxtr-crnn-mobilenet-v3-small, onnxtr-crnn-vgg16-bn, onnxtr-parseq, onnxtr-parseq-multilingual-v1,
  onnxtr-viptr-tiny, onnxtr-tablecenternet, onnxtr-lw-detr-s
- Xenova/trocr-small-printed, Xenova/trocr-small-handwritten, Xenova/trocr-base-handwritten,
  Xenova/trocr-base-printed, Xenova/table-transformer-detection,
  Xenova/table-transformer-structure-recognition-v1.1-all, qualcomm/EasyOCR
- datalab-to/surya-ocr-2, datalab-to/surya-ocr-2.5, vikp/surya_det3, stepfun-ai/GOT-OCR2_0,
  ningpp/GOT-OCR-2.0-ONNX
- onnx-community/Florence-2-base, onnx-community/Florence-2-base-ft, onnx-community/Florence-2-large-ft,
  HuggingFaceTB/SmolVLM-256M-Instruct, HuggingFaceTB/SmolVLM-500M-Instruct,
  onnx-community/granite-docling-258M-ONNX, Xenova/moondream2, onnx-community/PaddleOCR-VL-1.5-ONNX,
  onnx-community/LightOnOCR-2-1B-ONNX, LiquidAI/LFM2.5-VL-450M, LiquidAI/LFM2.5-VL-450M-ONNX,
  onnx-community/FastVLM-0.5B-ONNX, onnx-community/Qwen2-VL-2B-Instruct
- briaai/RMBG-1.4, briaai/RMBG-2.0, onnx-community/BiRefNet_lite-ONNX, onnx-community/BiRefNet-ONNX,
  onnx-community/BiRefNet_512x512-ONNX, onnx-community/BiRefNet-portrait-ONNX, ZhengPeng7/BiRefNet,
  ZhengPeng7/BiRefNet_lite, ZhengPeng7/BiRefNet-matting, ZhengPeng7/BiRefNet_HR-matting,
  wonfy/BiRefNet_lite-ONNX-webgpu, shozebDev/birefnet-lite-512-onnx
- onnx-community/ISNet-ONNX, imgly/isnet-general-onnx, BritishWerewolf/U-2-Netp, BritishWerewolf/U-2-Net,
  Xenova/modnet, onnx-community/mediapipe_selfie_segmentation, PramaLLC/BEN2, onnx-community/BEN2-ONNX,
  OS-Software/InSPyReNet-SwinB-Plus-Ultra-ONNX, onnx-community/ormbg-ONNX, schirrmacher/ormbg
- Xenova/slimsam-77-uniform, Xenova/slimsam-50-uniform, onnx-community/sam2.1-hiera-tiny-ONNX,
  onnx-community/sam2.1-hiera-small-ONNX, onnx-community/sam2.1-hiera-base-plus-ONNX,
  PulpCut/mobilesam-onnx, chongzhou/EdgeSAM, onnx-community/sam3-tracker-ONNX, facebook/sam3,
  Xenova/vitmatte-small-composition-1k, Xenova/vitmatte-small-distinctions-646,
  hustvl/vitmatte-small-composition-1k
- imgdesignart/realesrgan-x4-onnx, TheGuy444/Real-ESRGAN-ONNX, xrds/realesrgan-x4v3-fixed,
  lxfater/inpaint-web, Xenova/swin2SR-lightweight-x2-64, Xenova/swin2SR-classical-sr-x2-64,
  Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr, Xenova/swin2SR-compressed-sr-x4-48,
  Xenova/4x_APISR_GRL_GAN_generator-onnx, Xenova/2x_APISR_RRDB_GAN_generator-onnx,
  deepghs/waifu2x_onnx, nunif/waifu2x, darktable-org/upscale-realplksr-onnx, Heliosoph/scunet-onnx,
  Heliosoph/swinir-onnx, rocca/swin-ir-onnx, MahoCommerce/Real_HAT_GAN_sharper-ONNX, Acly/Omni-SR,
  opencv/deblurring_nafnet, qualcomm/NAFNet-DeNoise
- netrunner-exe/Face-Upscalers-onnx, Meeperomi/GFPGANv1.4-onnx, yuvraj108c/codeformer-onnx
- andraniksargsyan/migan, anyisalin/migan-onnx, Carve/LaMa-ONNX, anyisalin/big-lama-onnx,
  smile-forge/big-lama-onnx, opencv/inpainting_lama, Liiesl/aot-inpainting-onnx
- onnx-community/mobilenetv4_conv_small.e2400_r224_in1k, onnx-community/mobilenetv4_conv_medium.e500_r256_in1k,
  onnx-community/siglip2-base-patch16-224-ONNX, onnx-community/clip-vit-base-patch32-ONNX,
  Xenova/mobileclip_s0, Xenova/mobileclip_s2, apple/MobileCLIP2-S0,
  xinyu1205/recognize-anything-plus-model, SmilingWolf/wd-swinv2-tagger-v3
- onnx-community/dfine_n_coco-ONNX, onnx-community/dfine_s_coco-ONNX, onnx-community/dfine_s_obj365-ONNX,
  ustc-community/dfine_n_coco, onnx-community/rfdetr_nano-ONNX, onnx-community/rfdetr_small-ONNX,
  onnx-community/rfdetr_medium-ONNX, onnx-community/rtdetr_v2_r18vd-ONNX, onnx-community/yolov10n,
  onnx-community/yolo26n-ONNX, onnx-community/owlv2-base-patch16-ensemble-ONNX,
  onnx-community/grounding-dino-tiny-ONNX
- opencv/face_detection_yunet, garavv/blazeface-onnx, Marqo/nsfw-image-detection-384,
  Falconsai/nsfw_image_detection, AdamCodd/vit-base-nsfw-detector,
  onnx-community/nsfw_image_detection-ONNX, Sunxyw/nsfwjs-onnx
- onnx-community/depth-anything-v2-small, onnx-community/depth-anything-v2-base,
  onnx-community/depth-anything-v3-small, onnx-community/DepthPro-ONNX, Xenova/vit-gpt2-image-captioning,
  ningpp/blip-image-captioning-base-ONNX
- piddnad/ddcolor_paper_tiny, piddnad/ddcolor_modelscope, piddnad/ddcolor_artistic,
  Diogo122333/ddcolor-512-fp16, xrds/deoldify, mlboydaisuke/zero-dce-litert, CaiYuanhao/Retinexformer
- Spaces (checked to exist and which model they load): https://huggingface.co/spaces/Xenova/florence2-webgpu,
  https://huggingface.co/spaces/HuggingFaceTB/SmolVLM-256M-Instruct-WebGPU,
  https://huggingface.co/spaces/ibm-granite/granite-docling-258M-WebGPU,
  https://huggingface.co/spaces/Xenova/experimental-moondream-webgpu,
  https://huggingface.co/spaces/Xenova/segment-anything-webgpu,
  https://huggingface.co/spaces/webml-community/remove-background-webgpu,
  https://huggingface.co/spaces/Xenova/remove-background-webgpu,
  https://huggingface.co/spaces/Xenova/webgpu-realtime-depth-estimation,
  https://huggingface.co/spaces/LiquidAI/LFM2.5-VL-450M-WebGPU

Upstream projects and licence files (licence read through the GitHub API):

- https://github.com/PaddlePaddle/PaddleOCR, https://github.com/RapidAI/RapidOCR,
  https://github.com/mindee/doctr, https://github.com/felixdittrich92/OnnxTR,
  https://github.com/JaidedAI/EasyOCR, https://github.com/naptha/tesseract.js,
  https://github.com/tesseract-ocr/tessdata_fast, https://github.com/tesseract-ocr/tessdata_best,
  https://github.com/datalab-to/surya, https://github.com/microsoft/unilm, https://github.com/vikhyat/moondream
- https://github.com/xuebinqin/DIS, https://github.com/xuebinqin/U-2-Net, https://github.com/ZHKKKe/MODNet,
  https://github.com/plemeri/InSPyReNet, https://github.com/ZhengPeng7/BiRefNet,
  https://github.com/ChaoningZhang/MobileSAM, https://github.com/chongzhou96/EdgeSAM,
  https://github.com/facebookresearch/sam2, https://github.com/czg1225/SlimSAM,
  https://github.com/hustvl/ViTMatte
- https://github.com/xinntao/Real-ESRGAN (and its releases), https://github.com/JingyunLiang/SwinIR,
  https://github.com/mv-lab/swin2sr, https://github.com/XPixelGroup/HAT, https://github.com/zhengchen1999/DAT,
  https://github.com/Kiteretsu77/APISR, https://github.com/hongyuanyu/SPAN, https://github.com/bilibili/ailab,
  https://github.com/nagadomi/nunif, https://github.com/megvii-research/NAFNet, https://github.com/cszn/SCUNet,
  https://github.com/swz30/Restormer, https://github.com/jiaxi-jiang/FBCNN, https://github.com/TencentARC/GFPGAN,
  https://github.com/sczhou/CodeFormer, https://github.com/yangxy/GPEN,
  https://github.com/wzhouxiff/RestoreFormerPlusPlus
- https://github.com/advimman/lama, https://github.com/Picsart-AI-Research/MI-GAN (README and
  LICENSE-WEIGHTS), https://github.com/fenglinglwb/MAT, https://github.com/DQiaole/ZITS_inpainting,
  https://github.com/lxfater/inpaint-web (src/adapters/cache.ts, src/adapters/inpainting.ts)
- https://github.com/Peterande/D-FINE, https://github.com/roboflow/rf-detr, https://github.com/lyuwenyu/RT-DETR,
  https://github.com/THU-MIG/yolov10, https://github.com/ultralytics/ultralytics,
  https://github.com/deepinsight/insightface, https://github.com/DepthAnything/Depth-Anything-V2,
  https://github.com/ByteDance-Seed/Depth-Anything-3, https://github.com/xinyu1205/recognize-anything,
  https://github.com/apple/ml-mobileclip, https://github.com/google-research/big_vision,
  https://github.com/infinitered/nsfwjs, https://github.com/openai/CLIP
- https://github.com/piddnad/DDColor, https://github.com/jantic/DeOldify,
  https://github.com/mahmoudnafifi/Deep_White_Balance, https://github.com/Li-Chongyi/Zero-DCE,
  https://github.com/caiyuanhao1998/Retinexformer
- https://github.com/opencv/opencv_zoo (per-model LICENSE files for YuNet, LaMa, NAFNet)

Runtime and browser OCR:

- https://github.com/microsoft/onnxruntime/blob/main/js/web/docs/webgpu-operators.md
- https://www.paddleocr.ai/latest/en/version3.x/inference_deployment/cross_platform/browser.html
- https://cdn.jsdelivr.net/npm/ppu-paddle-ocr@6.0.0/README.md
- https://cdn.jsdelivr.net/npm/ffocr@0.1.13/README.md
- https://arxiv.org/pdf/2606.13108 (PP-OCRv6 technical report)
- https://data.jsdelivr.com/v1/packages/npm/tesseract.js-core@7.0.0 (WASM sizes)
- https://bria.ai/bria-huggingface-model-license-agreement/ (returned 404)
- `src/quire/dictation/parakeet/RUNTIME.md` in this repository
