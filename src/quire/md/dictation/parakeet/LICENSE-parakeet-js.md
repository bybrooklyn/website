# parakeet.js

Parts of the files in this folder re-express parts of parakeet.js
(https://github.com/ysdede/parakeet.js), written again in this site's own TypeScript from reading
its source, not copied. parakeet.js is under the MIT licence:

```
MIT License

Copyright (c) 2025 Yunus Seyhan Dede

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Which files re-express which parts

| File | Re-expresses | How it differs |
| --- | --- | --- |
| `features.ts`, `fft.ts` | `mel.js`, the log-mel spectrogram | reflects the sound at its edges as NeMo does (parakeet.js pads with zeros and is one frame short), and can compute frames as the sound arrives |
| `decode.ts` | `transcribe()` in `parakeet.js`, the greedy token-and-duration decoding loop | reads the prediction network's layers and size from the model instead of assuming two of 640, reuses its buffers, and can stop and go on at any frame |
| `tokens.ts` | `tokenizer.js`, the vocabulary and the joining of pieces into words | also splits a typed word into pieces |

Written without parakeet.js's source and not based on it: `boost.ts` (leaning toward the visitor's
words), `runtime.ts` (finding and loading ONNX Runtime), `stream.ts` (live words), `index.ts`.
