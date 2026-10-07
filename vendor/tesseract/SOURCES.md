# vendor/tesseract - the photo reader, copied by `npm run vendor:ocr`

| File | From (npm) | Version | Bytes |
|---|---|---|---|
| tesseract.min.js | tesseract.js/dist | 5.1.1 | 66,695 |
| worker.min.js | tesseract.js/dist | 5.1.1 | 123,724 |
| core/tesseract-core-lstm.wasm.js | tesseract.js-core | 5.1.1 | 3,938,277 |
| core/tesseract-core-simd-lstm.wasm.js | tesseract.js-core | 5.1.1 | 3,938,657 |
| lang/tha.traineddata.gz | @tesseract.js-data/tha 4.0.0_best_int | 1.0.0 | 896,631 |
| lang/eng.traineddata.gz | @tesseract.js-data/eng 4.0.0_best_int | 1.0.0 | 2,952,873 |

A browser downloads one of the two core files (SIMD if it can) plus both
language files: about 8 MB, once, on first photo use (Co's spec: lazy).
Licences: tesseract.js / tesseract.js-core Apache-2.0; traineddata Apache-2.0.
