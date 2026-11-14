# The speech models of dictation

The list is one small table in code: `TIERS` in `models.ts`. A row says which Hugging Face repository
the files come from and at which revision, the path, size and (when known) SHA-256 of each file in it,
the license and who to credit. To point a tier at files you have made yourself, change that row
(`repo`, `revision`, and the `path`, `bytes` and `sha256` of each file) and nothing else. The engine reads the role of each file (`encoder`, `decoder`, `vocab` or
`tokenizer`), not its name.

A tier whose encoder can run on the graphics card says so (`card: true`); the runtime then uses the card if the
browser has a real one, and the panel says "graphics card" or "processor". Only a 4-bit encoder can.

Sizes in the table must be the real sizes in bytes: the download refuses a file that arrives at any
other size (a half-written or changed file), and the panel shows the sum. A file with a `sha256` is
refused unless its bytes have that digest. A kept file is marked with the revision, size and digest
it was fetched for, and is fetched again when the row says otherwise, so a changed row never runs on
old bytes. `revision` should be a commit hash, which pins the files; the rows are still on `main`
and have no digests until those are read from Hugging Face and written in.

## What is measured

Four short sentences read by `espeak-ng` (a robotic voice, so every figure is a little worse than for a person)
with a pause between them, 43 words, played into headless Chromium as its microphone
(`scripts/dictation-check.ts`), on a served build with the site's `_headers`, on one desktop (16 threads, RTX 3070 Ti;
the integrated Radeon 610M where said). Word error is against the known text, case and punctuation ignored.
"Speed" is how long the recognizing takes for each second of sound it covers, window overlap included (the old
figure was whole phrases at once; whole-file speeds are in RUNTIME.md). Cold start is from pressing the button to
listening, **including the download**, so it depends on the connection (the same file took 16 s and 200 s on two
runs); warm start is a page load that finds the files in the browser's storage.

Before is the engine on parakeet.js (Ultra int8, Redux w2a8, one thread, no live words for the two big models);
after is the rewrite. The two Parakeet tiers are not the same file any more: Accurate uses the 4-bit encoder.

| Tier | Where | Download | Cold start | Warm start | Live word delay | Word error | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ultra, before | processor, 1 thread | 668 MB | 252 s | 2.0 s | at the pause only | 0 % | whole-file speed 0.54 |
| Accurate (Ultra w4a8) | processor, 8 threads | 383 MB | 16 s | 1.0 s | 0.6 s median, 1.3 s at the 90th percentile | 0 % (0 of 43), 4 runs | |
| Accurate | processor, 1 thread (a page that is not isolated) | 383 MB | 12 s | 1.0 s | at the pause only: the machine falls behind and says so | 0 % | whole-file speed 0.38 |
| Accurate | graphics card, RTX 3070 Ti | 383 MB | 200 s | 2.0 s | 0.4 s median, 0.8 s at the 90th | 0 % | |
| Accurate | graphics card, Radeon 610M (2 compute units) | 383 MB | 417 s | 2.0 s | 1.0 s median, 1.6 s at the 90th | 0 % | |
| Redux, before | processor, 1 thread | 208 MB | 6.1 s | 1.0 s | at the pause only | 7.0 % and 4.7 % | whole-file speed 0.50 |
| Light (Redux w2a8) | processor, 8 threads | 208 MB | 8 to 160 s | 1.0 s | 0.7 s median, 1.2 s at the 90th | 4.7 % to 7.0 % (2 to 3 of 43), 5 runs | the same words wrong as before ("weather" as "Mawarmer") |
| Light | processor, 1 thread | 208 MB | 6.1 s | 1.0 s | at the pause only | 4.7 % | |
| Tiny, before | processor, 1 thread | 55 MB | 3.1 s | 2.1 s | 0.2 s | 9.3 % | speed 0.04 |
| Tiny (Moonshine) | processor, 8 threads | 55 MB | 5.1 s | 1.0 s | 0.1 s to 0.2 s median, 0.5 to 0.75 s at the 90th | 7.0 % to 11.6 % (3 to 5 of 43) | it varies from run to run with when the windows fall |

Memory is measured as the growth of the browser's resident memory (the machine also runs other browsers, so the
absolute figures are not meaningful): while listening, Accurate on the processor held about 1.2 GB more than the idle
page, on the card 1.7 to 2.0 GB, Light 0.8 GB, Tiny 0.3 to 0.5 GB; 36 s after dictation was switched off all of
them were back to within the noise of the measure of where they began. Typing while dictating: a key pressed every
third of a second, to the next paint, had a median of 7 to 11 ms in every row and a maximum of 17 to 18 ms (one 60 Hz
frame is 16.7 ms), in one run in thirty a frame of 33 ms; the page draws at its own pace while the model works in
its worker.

The two Parakeet tiers with 8 threads give live words that appear 0.6 to 0.7 s after they are said, and the
Accurate tier on the card 0.4 s. On one thread the encoder takes 1.1 to 1.2 s of work for each second of sound
(four seconds of window every second), so it cannot keep up; the session sees that and writes each phrase at the
pause, as the old engine did, and the panel says so. Tiny has room to spare on one thread and shows live words from
windows, as it did.

Other candidates that were tried:

| Candidate | What happened |
| --- | --- |
| `Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx`, int8 encoder (649 MB) and decoder | Was the main tier. Replaced by the w4a8 encoder below: same words, 266 MB smaller, as fast on the processor, and the only one the card can run. |
| the same repository's `w4a8/encoder-model.w4a8.onnx` (4-bit MatMulNBits, 383 MB) | **Used as Accurate**, on the card and on the processor. 0 of 43 words wrong on the processor and on both cards. |
| the same repository's `fp16/encoder-model.fp16.onnx` (1.2 GB) | Runs on the card, 2.4 times faster than w4a8 there, but three times the download. Not offered. |
| `Olicorne/parakeet-tdt-0.6b-v3-redux-onnx`, w2a8 encoder (2-bit MatMulNBits) | Used as **Light**. Runs on the processor only: the card takes 4-bit encoders, and this repository has none. |
| `ryusei-46/parakeet-ultra-ONNX-WebGPU` (int4 encoder, fp32 decoder) | Not tried: it needs `externalData`, which the runtime does not take; the single-file w4a8 does the same. |
| `Masterx/parakeet-tdt-0.6b-ultra-onnx` (fp16, int8) | Not needed; same layout as the Olicorne files. |
| `OpenVoiceOS/nvidia-parakeet-tdt_ctc-110m-onnx` (NVIDIA Parakeet TDT-CTC 110M, int8, 131 MB + 5 MB) | Runs on our recognizer, which reads the one-layer prediction network from the file (parakeet.js assumed two layers and failed at the first step); 80 mel bands. Speed 0.07, but **16.3 % word error**: worse than Moonshine tiny and 2.5 times the size. Not offered. |
| `onnx-community/moonshine-tiny-ONNX`, all-int8 | 25.6 % word error. The int8 encoder is the cause (an int8 encoder with the fp32 decoder gave 16.3 %). |
| the same with the fp32 encoder and the int8 decoder | 7.0 % to 11.6 % in the browser. Used as **Tiny**. |
| `moonshine-ai/moonshine-streaming-tiny` | Only a `model.safetensors` (176 MB) and a tokenizer; no ONNX files. Not run. |

## What the recognizer needs of a Parakeet export

`parakeet/index.ts` opens a model from three things (the mel filterbank is computed in `features.ts`, so there is
no `nemo*.onnx` to ship):

1. **The encoder**, an ONNX file. Input `audio_signal` float32 `[batch, mels, frames]` (mels is 128 for
   the 0.6b models, 80 for the 110m) and `length` int64 `[batch]`. Output `outputs` float32
   `[batch, hidden, frames / 8]` (hidden 1024 for the 0.6b, 512 for the 110m) and `encoded_lengths`.
   The subsampling is 8. A model larger than 2 GB keeps its weights in a second file (`.onnx.data`);
   dictation does not support that, so the encoder must be a single file. To run on the graphics card it
   must be a 4-bit `MatMulNBits` encoder (`w4a8`); the 8-bit and 2-bit ones run on the processor only.
2. **The decoder and joiner in one file**, `decoder_joint`. Inputs `encoder_outputs` float32
   `[batch, hidden, 1]` (one encoder frame at a time), `targets` int32 `[batch, 1]`, `target_length`
   int32 `[batch]`, `input_states_1` and `input_states_2` float32 `[layers, batch, 640]`. Outputs
   `outputs` float32 `[batch, 1, 1, vocabulary + durations]`, `prednet_lengths`, `output_states_1` and
   `output_states_2`. Extra outputs (the Olicorne files add `lse_token`, `topk_logits` and others) are
   ignored. The number of layers and the hidden size are read from the file, so a one-layer prediction
   network (the 110m) runs; parakeet.js had two fixed.
3. **The vocabulary**, `vocab.txt`: one line per token, `token id`, with the blank written `<blk>`.
   Tokens begin a word with the SentencePiece mark (`▁`).

The decoder is the TDT one: the joiner's output is the token logits followed by the duration logits.

### Quantization that kept accuracy

| File | Used and measured |
| --- | --- |
| 0.6b encoder, int8 (dynamic, weights and activations) | Kept accuracy: 0 errors in 43 words in the batch test, 9 % with the streaming windows and the robotic voice. 649 MB. |
| 0.6b encoder, w2a8 (2-bit weights, 8-bit activations, `MatMulNBits`, block 128) | Kept accuracy because the Redux weights are already ternary, so 2 bits hold them exactly. 190 MB. Runs on CPU and WASM only. |
| decoder_joint, int8 | Fine for all three. |
| Moonshine tiny encoder, int8 | **Lost accuracy** (7.0 % to 25.6 %). Kept fp32. |
| Moonshine tiny decoder (merged), int8 | Kept accuracy. |

## Making an export yourself

**None of the commands below were run here** (the checkpoints are 2.5 GB and need a Python machine
learning stack, which was not installed). They are what the working exports document, written down
so that you can try them; treat every one as untested.

### Parakeet TDT 0.6b (any checkpoint of that architecture, such as Ultra or Redux)

Start from the `.nemo` file (for example `parakeet-tdt-0.6b-v3-ultra.nemo` in
`Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx`, 2.5 GB).

```sh
python -m venv nemo && . nemo/bin/activate
pip install "nemo_toolkit[asr]" onnx onnxruntime
python - <<'EOF'
import nemo.collections.asr as nemo_asr
model = nemo_asr.models.ASRModel.restore_from("parakeet-tdt-0.6b-v3-ultra.nemo", map_location="cpu")
model.eval()
# for an RNNT or TDT model this writes encoder-model.onnx and decoder_joint-model.onnx
model.export("model.onnx")
EOF
```

Then check the names and shapes against the list above (`python -c "import onnx; ..."` or ORT's
`session.get_inputs()`): the decoder's states must be `[2, batch, 640]`.

Quantize the encoder to int8 (this is what the working files use):

```python
from onnxruntime.quantization import quantize_dynamic, QuantType
quantize_dynamic("encoder-model.onnx", "encoder-model.int8.onnx", weight_type=QuantType.QInt8)
quantize_dynamic("decoder_joint-model.onnx", "decoder_joint-model.int8.onnx", weight_type=QuantType.QInt8)
```

If the fp32 encoder is over 2 GB the exporter writes `encoder-model.onnx.data` beside it; load it
with `onnx.load(path, load_external_data=True)` and save with everything in one file
(`onnx.save(model, out, save_as_external_data=False)`) only if it is under 2 GB after quantization,
which the int8 encoder is.

Write `vocab.txt` from the model's tokenizer, `token id` per line, with `<blk>` as the last id.
For the 2-bit encoder, `Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx` has `scripts/build-from-nemo-export.sh --ternary`
(its README describes the graph fold, the 12-bit rounding and the `MatMulNBits` packing); use that,
not a hand-made one.

Then put the files in a Hugging Face repository (or any host that sends CORS headers and honours
`Range` requests), add the host to `connect-src` in `astro.config.ts`, and change the row in `models.ts`.

### Parakeet TDT-CTC 110m (a smaller Parakeet)

`nvidia/parakeet-tdt_ctc-110m` exports the same way, to `encoder-model.onnx` and
`decoder_joint-model.onnx`, with 80 mel bands and a one-layer prediction network. Our recognizer runs it
(`bins: 80`); it scored 16 % word error, worse than Moonshine tiny, so it is not offered.

### Moonshine tiny

Nothing to export: `onnx-community/moonshine-tiny-ONNX` has the files. To make an encoder that keeps
accuracy at a smaller size than fp32 (30.9 MB), the repository also has `encoder_model_fp16.onnx`
(15.5 MB), `encoder_model_q4f16.onnx` (6.9 MB) and `encoder_model_bnb4.onnx` (10.4 MB); **none of
these were measured here**, and the lesson of the int8 encoder is that each needs measuring before
use. The decoding code is `moonshine.ts`.
