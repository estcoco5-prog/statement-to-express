// Krungthai passbook printer. Measured on a 200 dpi scan: the line height its
// patterns were taken at, its box width as a share of that height, and the
// grey level below which a pixel is ribbon ink (the cyan print stays above it).
import { decodePatterns } from '../reader.js';
import { STORED } from './ktb-patterns.js';

export const KTB_PASSBOOK = {
  key: 'ktbpb',
  bank: 'KTB passbook (สมุดบัญชีกรุงไทย)',
  inkBelow: 150,
  lineHeight: 21,
  ratio: 10.32 / 21,
  maxPatterns: 24,           // per symbol, after learning from proved rows
  patterns: decodePatterns(STORED),
};
