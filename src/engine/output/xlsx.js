// A real .xlsx workbook, ported from the answer key's xlsx_writer.py. Same XML,
// same order, same escaping - the oracle compares every part as text.
//
// On OUR sheets dates are TEXT (2026-06-09): a Thai Windows install can show
// real date values in the Buddhist Era, silently undoing the conversion.
// The Express import sheets are the exception (Express needs a date serial);
// their DATE style carries an explicit DD/MM/YYYY code, which is always
// rendered in the Gregorian calendar.
import { zipStore } from './zip.js';

// Style slots, in the order STYLES defines them.
export const PLAIN = 0, HEADER = 1, MONEY = 2, MONEY_BOLD = 3, BAD = 4, BOLD = 5, DATE = 6;
// TODO = a blank cell a person must fill in (yellow). EXTRA* = a helper column
// that must be deleted before importing (grey).
export const TODO = 7, EXTRA = 8, EXTRA_MONEY = 9, EXTRA_HEAD = 10;

// The fixed parts, copied byte-for-byte from the answer key's xlsx_writer.py
// (generated with json.dumps, newlines included) - do not edit by hand.
const CONTENT_TYPES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\n<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\n<Default Extension=\"xml\" ContentType=\"application/xml\"/>\n<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>\n<Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/>\n{sheet_overrides}\n</Types>";
const ROOT_RELS = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\n<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>\n</Relationships>";
const STYLES = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\">\n<numFmts count=\"2\"><numFmt numFmtId=\"164\" formatCode=\"#,##0.00\"/><numFmt numFmtId=\"165\" formatCode=\"DD/MM/YYYY\"/></numFmts>\n<fonts count=\"3\">\n<font><sz val=\"10\"/><name val=\"Tahoma\"/></font>\n<font><b/><sz val=\"10\"/><name val=\"Tahoma\"/></font>\n<font><sz val=\"10\"/><color rgb=\"FFC00000\"/><name val=\"Tahoma\"/></font>\n</fonts>\n<fills count=\"5\">\n<fill><patternFill patternType=\"none\"/></fill>\n<fill><patternFill patternType=\"gray125\"/></fill>\n<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFEFEFEF\"/><bgColor indexed=\"64\"/></patternFill></fill>\n<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFFFFF00\"/><bgColor indexed=\"64\"/></patternFill></fill>\n<fill><patternFill patternType=\"solid\"><fgColor rgb=\"FFD9D9D9\"/><bgColor indexed=\"64\"/></patternFill></fill>\n</fills>\n<borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders>\n<cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs>\n<cellXfs count=\"11\">\n<xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/>\n<xf numFmtId=\"0\" fontId=\"1\" fillId=\"2\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>\n<xf numFmtId=\"164\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>\n<xf numFmtId=\"164\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFont=\"1\"/>\n<xf numFmtId=\"0\" fontId=\"2\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>\n<xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/>\n<xf numFmtId=\"165\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\"/>\n<xf numFmtId=\"0\" fontId=\"0\" fillId=\"3\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>\n<xf numFmtId=\"0\" fontId=\"0\" fillId=\"4\" borderId=\"0\" xfId=\"0\" applyFill=\"1\"/>\n<xf numFmtId=\"164\" fontId=\"0\" fillId=\"4\" borderId=\"0\" xfId=\"0\" applyNumberFormat=\"1\" applyFill=\"1\"/>\n<xf numFmtId=\"0\" fontId=\"1\" fillId=\"4\" borderId=\"0\" xfId=\"0\" applyFont=\"1\" applyFill=\"1\"/>\n</cellXfs>\n<cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles>\n</styleSheet>";

// Python's xml.sax.saxutils.escape: & < > only.
const escape = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Python's repr(float): JS agrees except that whole numbers keep ".0".
const pyFloatText = v => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// One cell: a value and a style. A number is an Excel integer unless its kind
// is 'float' (money), which is written the way Python writes float().
export class Cell {
  constructor(value, style = PLAIN, kind = null) {
    this.value = value;
    this.style = style;
    this.kind = kind ?? (typeof value === 'number' ? 'int' : 'text');
  }
}

// A money cell from satang, written as Python's float(Decimal).
export const money = (satang, style = MONEY) => new Cell(satang / 100, style, 'float');

export class Sheet {
  constructor(name, { widths = [], freezeRows = 0, table = null } = {}) {
    // Excel rejects these characters in a sheet name, and caps it at 31.
    for (const bad of '[]:*?/\\') name = name.split(bad).join('-');
    this.name = name.slice(0, 31);
    this.rows = [];
    this.widths = widths;
    this.freezeRows = freezeRows;
    // [tableName, headerRow] makes this sheet a real Excel Table, as Express's
    // import templates are.
    this.table = table;
  }
  // Add one row. Bare values are drawn plain; wrap in Cell() to style.
  add(...cells) {
    this.rows.push(cells.map(c => (c instanceof Cell ? c : new Cell(c))));
  }
}

// 0 -> A, 25 -> Z, 26 -> AA.
export function colLetter(index) {
  let name = '';
  index += 1;
  while (index) {
    const rem = (index - 1) % 26;
    index = Math.floor((index - 1) / 26);
    name = String.fromCharCode(65 + rem) + name;
  }
  return name;
}

function cellXml(ref, cell) {
  if (cell.value === null || cell.value === undefined || cell.value === '') return `<c r="${ref}" s="${cell.style}"/>`;
  if (cell.kind === 'int') return `<c r="${ref}" s="${cell.style}"><v>${cell.value}</v></c>`;
  if (cell.kind === 'float') return `<c r="${ref}" s="${cell.style}"><v>${pyFloatText(cell.value)}</v></c>`;
  return `<c r="${ref}" s="${cell.style}" t="inlineStr"><is><t xml:space="preserve">${escape(cell.value)}</t></is></c>`;
}

function sheetXml(sheet) {
  const parts = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  if (sheet.freezeRows) {
    parts.push('<sheetViews><sheetView workbookViewId="0">' +
      `<pane ySplit="${sheet.freezeRows}" topLeftCell="A${sheet.freezeRows + 1}" ` +
      'activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>');
  }
  if (sheet.widths.length) {
    parts.push(`<cols>${sheet.widths.map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`);
  }
  parts.push('<sheetData>');
  sheet.rows.forEach((row, r) => {
    parts.push(`<row r="${r + 1}">${row.map((cell, c) => cellXml(`${colLetter(c)}${r + 1}`, cell)).join('')}</row>`);
  });
  parts.push('</sheetData>');
  if (sheet.table) parts.push('<tableParts count="1"><tablePart r:id="rIdTable"/></tableParts>');
  parts.push('</worksheet>');
  return parts.join('');
}

function tableRef(sheet) {
  const headerRow = sheet.table[1];
  const width = sheet.rows[headerRow - 1].length;
  const lastRow = Math.max(sheet.rows.length, headerRow);
  return [`A${headerRow}:${colLetter(width - 1)}${lastRow}`, width];
}

function tableXml(sheet, tableId) {
  const [name, headerRow] = sheet.table;
  const [ref, width] = tableRef(sheet);
  const columns = sheet.rows[headerRow - 1].slice(0, width)
    .map((c, i) => `<tableColumn id="${i + 1}" name="${escape(c.value)}"/>`).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    `id="${tableId}" name="${escape(name)}" displayName="${escape(name)}" ` +
    `ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${width}">${columns}</tableColumns>` +
    '<tableStyleInfo name="TableStyleLight19" showFirstColumn="0" ' +
    'showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>' +
    '</table>';
}

// Every part of the workbook as [{name, text}], in the answer key's order.
export function workbookParts(sheets) {
  if (!sheets.length) throw new Error('a workbook needs at least one sheet');
  const tables = sheets.map((s, i) => [i + 1, s]).filter(([, s]) => s.table);

  const overrides = [
    ...sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'),
    ...tables.map((_, n) => `<Override PartName="/xl/tables/table${n + 1}.xml" ` +
      'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>'),
  ].join('\n');

  const sheetTags = sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
  const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets>${sheetTags}</sheets></workbook>`;

  let rels = sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/` +
    'officeDocument/2006/relationships/worksheet" ' +
    `Target="worksheets/sheet${i + 1}.xml"/>`).join('');
  rels += `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/` +
    'officeDocument/2006/relationships/styles" Target="styles.xml"/>';
  const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/' +
    `relationships">${rels}</Relationships>`;

  const parts = [
    { name: '[Content_Types].xml', text: CONTENT_TYPES.replace('{sheet_overrides}', overrides) },
    { name: '_rels/.rels', text: ROOT_RELS },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    { name: 'xl/styles.xml', text: STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s) })),
  ];
  tables.forEach(([i, sheet], n) => {
    parts.push({ name: `xl/tables/table${n + 1}.xml`, text: tableXml(sheet, n + 1) });
    parts.push({
      name: `xl/worksheets/_rels/sheet${i}.xml.rels`,
      text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" ' +
        `Target="../tables/table${n + 1}.xml"/></Relationships>`,
    });
  });
  return parts;
}

export function writeXlsx(sheets) {
  return zipStore(workbookParts(sheets).map(p => ({ name: p.name, data: p.text })));
}
