# pdf.js - vendored with ONE patch

`pdf.min.mjs` and `LICENSE` are pdf.js 6.3.289 (`pdfjs-dist/build/`) exactly.
`pdf.worker.min.mjs` carries one small patch. Re-create all three with:

    npm install && node tools/vendor-pdfjs.mjs

## The patch: pass ActualText through

Some statements (UOB's) draw text with a font whose own letter map is blank:
read directly, `UOB` comes out as `82%`. The real letters are
stored beside the glyphs in marked-content spans:

    /Span << /ActualText <FEFF0055004F0042...> >> BDC <00380032...> Tj EMC

Poppler, which the answer key uses, reads that ActualText. pdf.js already
reports each span to `getTextContent({ includeMarkedContent: true })`, but
passes on only its MCID. The patch adds one field to that report:

    actualText: <the span's raw /ActualText string, or null>

`src/engine/words.js` (`applyActualText`) then swaps each span's glyphs for
its text. Nothing else in pdf.js changes.

`tools/vendor-pdfjs.mjs` refuses to run if pdf.js no longer has exactly one
place to patch. The ActualText tests in `tests/words.test.js` fail without
the patch (checked: 4 of them go red), and the tests load this vendored copy
(`tests/pdfjs.js`), so they prove exactly what the page ships.
