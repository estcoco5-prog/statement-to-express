// The SAME pdf.js the page ships (vendor/pdfjs, including our one patch - see
// vendor/pdfjs/PATCHES.md), loaded for Node: tests and tools prove exactly
// what the browser runs. Node prints one "use the legacy build" warning; the
// modern build works here and that is the build we must test.
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

export default pdfjs;
