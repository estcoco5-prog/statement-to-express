# Statement → Express

A web page that turns Thai bank statement PDFs into the Express accounting
program's X Import file (ข้อมูลฝาก-ถอนเงิน), with every row proved against the
bank's own running balance.

**Privacy:** everything happens inside your browser. Statements, passwords and
results are never uploaded, stored or sent anywhere; closing the tab forgets them.

- Run the tests: `npm test` (tested on Node 26; no installs needed - the tests load
  the same vendored pdf.js the page ships)
- Serve locally: `npm run serve`, then open http://localhost:8141

Correctness is gated against a private reference implementation: on real
statements, every row, check and Excel cell must be identical before release.
Real statements are never committed to this repository.

pdf.js is vendored in `vendor/pdfjs/` with one small, documented patch
(see `vendor/pdfjs/PATCHES.md`); `npm run vendor` re-creates it.
