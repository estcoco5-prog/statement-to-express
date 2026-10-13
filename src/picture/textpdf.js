// A PDF given to Picture -> Excel that is not a scan: the bank's own PDF, with
// its figures as text. Bank PDF -> Express reads that text exactly, so the
// person is offered that card instead of reading pictures of it (Co 2026-10-13).
// A locked or broken PDF counts as no text: it goes on the way it always did.

const MONEY = /^[-+(]?\d{1,3}(,\d{3})*\.\d{2}\)?$|^[-+(]?\d+\.\d{2}\)?$/;

/** How many money figures the first pages hold as text (0 for a scan). */
export async function moneyTextIn(bytes, pdfjs, { pages = 3 } = {}) {
  let task;
  try {
    // a copy: pdf.js takes the buffer it is given
    task = pdfjs.getDocument({ data: bytes.slice() });
    const doc = await task.promise;
    let n = 0;
    for (let p = 1; p <= Math.min(pages, doc.numPages); p++) {
      const { items } = await (await doc.getPage(p)).getTextContent();
      n += items.filter(it => MONEY.test(String(it.str ?? '').trim())).length;
    }
    return n;
  } catch {
    return 0;
  } finally {
    await task?.destroy();
  }
}

// Five figures as text: a statement, not a scan with a stray caption.
export const TEXT_PDF_AT = 5;
