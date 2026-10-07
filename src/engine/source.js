// The mark a readable PDF made from photos (Tool A) carries in its document
// info. Tool B reads it to cap the result at yellow: arithmetic proves the
// money, but nothing proves a photo's dates and descriptions were read right.
export const TOOL_A_PRODUCER = 'statement-to-express Tool A (photo)';

// The bank the photo step recognised (by its mark or its column headings),
// kept in the document info as "bank:<key>". A photo can lose the mark the
// checker would look for, so the checker trusts this note instead - but only
// in a PDF that carries Tool A's mark.
// Summary pages (period and account facts only, no transactions) are listed
// by page number: "bank:uob summary:1".
export const BANK_NOTE = /^bank:([a-z]+)(?: summary:(\d+(?:,\d+)*))?$/;
