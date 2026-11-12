# The speech models of dictation

The list is one small table in code: `TIERS` in `models.ts`. A row says which Hugging Face repository
the files come from, the path and size of each file in it, the license and who to credit. To point a
tier at files you have made yourself, change that row (`repo`, and the `path` and `bytes` of each
file) and nothing else. The engine reads the role of each file (`encoder`, `decoder`, `vocab` or
`tokenizer`), not its name.

Sizes in the table must be the real sizes in bytes: the download refuses a file that arrives at any
other size (a half-written or changed file), and the panel shows the sum.

## What is measured

Four short sentences read by `espeak-ng` (a robotic voice, so every figure is a little worse than
for a person), 43 words, played into headless Chromium as its microphone (`scripts/dictation-check.ts`),
single-threaded WASM, on one desktop machine. Word error is against the known text, case and
punctuation ignored. "Speed" is recognizing time over sound time (0.04 means 25 times faster than
speech). Cold start is from pressing the button to listening, including the download.

| Tier | Model | Download | Cold start | Warm start | Speed | Word error, in the browser | Word error, whole sentences at once |
| --- | --- | --- | --- | --- | --- | --- | --- |
| main | Parakeet Ultra, int8 | 668 MB | 252 s (the download dominates; this connection) | 2.0 s | 0.54 | 0.0 % (0 of 43), twice | 0.0 % |
| light | Parakeet Redux, w2a8 | 208 MB | 6.1 s | 1.0 s | 0.50 | 7.0 % and 4.7 % (3 and 2 of 43) | 2.3 % |
| tiny | Moonshine tiny, fp32 encoder and int8 decoder | 55 MB | 3.1 s | 2.1 s | 0.04 | 9.3 % (4 of 43), the same twice | 7.0 % |

Warm start is a page load that finds the files already in the browser's storage. Loading the
session itself took 0.7 to 1.6 s of that. While listening, the main tier held about 1.8 to 2.0 GB
more memory than the idle page, and gave it back (to within the noise of the measure) about 35 s after
dictation was switched off; the other two were inside the noise of that measure (a headless browser
that itself uses 1 to 2.7 GB). The longest frame the page drew while the model worked was 17 ms
(one frame of 33 ms in all the runs), so typing is not held up. There is no WebGPU adapter in this
machine's headless Chromium, so only WASM was measured; every figure above is single-threaded
because the site does not send the cross-origin isolation headers that threads need.

The two Parakeet tiers are at about half of real time here (0.5), which is over the limit
(`LIVE_LIMIT`, 0.45 in `session.ts`) for showing live provisional words, so on this machine they write
each phrase at the pause and say so in the panel. Tiny has room to spare and shows live words.


Other candidates that were tried:

| Candidate | What happened |
| --- | --- |
| `Olicorne/parakeet-tdt-0.6b-v3-ultra-onnx`, int8 encoder and decoder | Loads in parakeet.js and ONNX Runtime Web 1.24.1 unchanged. Used as **main**. |
| `Olicorne/parakeet-tdt-0.6b-v3-redux-onnx`, w2a8 encoder (2-bit MatMulNBits) | Loads and runs on WASM unchanged. Used as **light**. |
| `ryusei-46/parakeet-ultra-ONNX-WebGPU` (int4 encoder, fp32 decoder) | Not tried: it is made for WebGPU, which parakeet.js runs only with an fp32 or fp16 encoder. |
| `Masterx/parakeet-tdt-0.6b-ultra-onnx` (fp16, int8) | Not needed; same layout as the Olicorne files. |
| `OpenVoiceOS/nvidia-parakeet-tdt_ctc-110m-onnx` (NVIDIA Parakeet TDT-CTC 110M, int8, 131 MB + 5 MB) | Loads, but parakeet.js assumes a prediction network of two layers and the 110M has one (`input_states_1` is `[1, batch, 640]`, not `[2, batch, 640]`), so it fails at the first decoder step with "Got invalid dimensions for input: input_states_1". Working around it means replacing the model's private `_combState1` and `_combState2` with one-layer zeros (and the model uses 80 mel bands, so `nMels: 80`). With that patch it ran at speed 0.07 and 16.3 % word error. Not used: less accurate than Moonshine tiny and 2.5 times the size, and it needs a patch to a private field. |
| `onnx-community/moonshine-tiny-ONNX`, all-int8 | 25.6 % word error. The int8 encoder is the cause (an int8 encoder with the fp32 decoder gave 16.3 %). |
| the same with the fp32 encoder and the int8 decoder | 7.0 % in the first test. Used as **tiny**. |
| `moonshine-ai/moonshine-streaming-tiny` | Only a `model.safetensors` (176 MB) and a tokenizer; no ONNX files. Not run. |

## What parakeet.js needs of a Parakeet export

It runs `ParakeetModel.fromUrls`, which wants three things (a fourth, `nemo*.onnx`, is only for the
ONNX preprocessor, and dictation uses the JavaScript one, `preprocessorBackend: "js"`):

1. **The encoder**, an ONNX file. Input `audio_signal` float32 `[batch, mels, frames]` (mels is 128 for
   the 0.6b models, 80 for the 110m) and `length` int64 `[batch]`. Output `outputs` float32
   `[batch, hidden, frames / 8]` (hidden 1024 for the 0.6b, 512 for the 110m) and `encoded_lengths`.
   The subsampling is 8. A model larger than 2 GB keeps its weights in a second file (`.onnx.data`);
   dictation does not support that, so the encoder must be a single file.
2. **The decoder and joiner in one file**, `decoder_joint`. Inputs `encoder_outputs` float32
   `[batch, hidden, 1]` (one encoder frame at a time), `targets` int32 `[batch, 1]`, `target_length`
   int32 `[batch]`, `input_states_1` and `input_states_2` float32 `[layers, batch, 640]`. Outputs
   `outputs` float32 `[batch, 1, 1, vocabulary + durations]`, `prednet_lengths`, `output_states_1` and
   `output_states_2`. Extra outputs (the Olicorne files add `lse_token`, `topk_logits` and others) are
   ignored. **`layers` must be 2**; that is fixed in parakeet.js.
3. **The vocabulary**, `vocab.txt`: one line per token, `token id`, with the blank written `<blk>`.
   Tokens begin a word with the SentencePiece mark (`▁`).
4. **The preprocessor** is in JavaScript (`mel.js` in parakeet.js): 128 mel bands (80 for the 110m),
   no file to ship.

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
`decoder_joint-model.onnx`, with 80 mel bands and a one-layer prediction network. parakeet.js cannot
run it as it is (see above). The two ways to make it run are to patch parakeet.js so that the number
of layers is read from the decoder's `input_states_1` shape instead of being 2, or to export the
decoder with a second, zero-filled layer, which changes the model and was not tried. Whichever is
done, measure it against Moonshine tiny before using it.

### Moonshine tiny

Nothing to export: `onnx-community/moonshine-tiny-ONNX` has the files. To make an encoder that keeps
accuracy at a smaller size than fp32 (30.9 MB), the repository also has `encoder_model_fp16.onnx`
(15.5 MB), `encoder_model_q4f16.onnx` (6.9 MB) and `encoder_model_bnb4.onnx` (10.4 MB); **none of
these were measured here**, and the lesson of the int8 encoder is that each needs measuring before
use. The decoding code is `moonshine.ts`.
