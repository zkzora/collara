// Small, valid synthetic evidence files for the LocalNet seed: single-page PDFs (Helvetica text) and a PNG
// photo sheet. Every file says it is synthetic. Deterministic bytes, so the server-computed SHA-256 values
// are stable across seeds.
import { crc32, deflateSync } from "node:zlib";

const SYNTHETIC_LINE = "SYNTHETIC DOCUMENT \\227 Collara demo only"; // \227 = em dash (WinAnsiEncoding)

function pdfEscape(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/** A one-page PDF 1.4 with a title and lines of text (ASCII; the synthetic banner uses an em dash). */
export function syntheticPdf(title: string, lines: readonly string[]): Buffer {
  const body = [
    "BT",
    "/F1 11 Tf",
    "72 740 Td",
    `(${SYNTHETIC_LINE}) Tj`,
    "/F1 16 Tf",
    "0 -32 Td",
    `(${pdfEscape(title)}) Tj`,
    "/F1 11 Tf",
    ...lines.flatMap((line) => ["0 -20 Td", `(${pdfEscape(line)}) Tj`]),
    "0 -32 Td",
    "(All names, numbers and identifiers in this file are synthetic.) Tj",
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let out = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// --- PNG -------------------------------------------------------------------------------------------

const FONT: Readonly<Record<string, readonly number[]>> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1e, 0x01, 0x01, 0x0e, 0x01, 0x01, 0x1e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  " ": [0, 0, 0, 0, 0, 0, 0],
};

type Rgb = readonly [number, number, number];

class Canvas {
  readonly pixels: Buffer;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.pixels = Buffer.alloc(width * height * 3);
  }
  rect(x: number, y: number, w: number, h: number, [r, g, b]: Rgb): void {
    for (let yy = Math.max(0, y); yy < Math.min(this.height, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.width, x + w); xx++) {
        const i = (yy * this.width + xx) * 3;
        this.pixels[i] = r;
        this.pixels[i + 1] = g;
        this.pixels[i + 2] = b;
      }
    }
  }
  text(x: number, y: number, value: string, scale: number, color: Rgb): void {
    let cx = x;
    for (const ch of value.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT[" "] ?? [];
      glyph.forEach((row, ry) => {
        for (let rx = 0; rx < 5; rx++) if (row & (0x10 >> rx)) this.rect(cx + rx * scale, y + ry * scale, scale, scale, color);
      });
      cx += 6 * scale;
    }
  }
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed) >>> 0);
  return Buffer.concat([length, typed, crc]);
}

function encodePng(canvas: Canvas): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const stride = canvas.width * 3;
  const raw = Buffer.alloc((stride + 1) * canvas.height);
  for (let y = 0; y < canvas.height; y++) canvas.pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Six synthetic "photos" (labelled tiles) on one PNG sheet, with a synthetic banner. */
export function syntheticPhotoSheet(): Buffer {
  const tileW = 160;
  const tileH = 120;
  const canvas = new Canvas(tileW * 3, tileH * 2 + 40);
  const palette: Rgb[] = [
    [70, 96, 120],
    [96, 110, 84],
    [120, 92, 70],
    [84, 84, 110],
    [110, 100, 70],
    [70, 110, 110],
  ];
  palette.forEach((color, i) => {
    const x = (i % 3) * tileW;
    const y = Math.floor(i / 3) * tileH;
    canvas.rect(x, y, tileW, tileH, color);
    canvas.rect(x + 20, y + 30, tileW - 40, tileH - 60, [color[0] + 40, color[1] + 40, color[2] + 40]);
    canvas.text(x + 12, y + 8, `PHOTO ${i + 1}`, 2, [240, 240, 240]);
  });
  canvas.rect(0, tileH * 2, canvas.width, 40, [24, 24, 24]);
  canvas.text(10, tileH * 2 + 12, "SYNTHETIC - COLLARA DEMO ONLY", 2, [250, 250, 250]);
  return encodePng(canvas);
}

export interface SyntheticFile {
  readonly key: string;
  readonly type: "DEALER_INVOICE" | "EQUIPMENT_PHOTOS" | "INSPECTION_REPORT" | "MAINTENANCE_SUMMARY" | "PURCHASE_AGREEMENT";
  readonly title: string;
  readonly fileName: string;
  readonly contentType: "application/pdf" | "image/png";
  readonly bytes: Buffer;
}

const ASSET_LINE = "Asset ASSET-DEMO-001 | CNC machining center | model DEMO-CNC-500 | serial SYNTH-CNC-001";

/** The CL-001 document set (daml-model.md §7: DOC-001 invoice, DOC-002 photos, DOC-003 inspection v1/v2, DOC-004 maintenance; DOC-005 purchase agreement). */
export function cl001Files(): Record<"invoice" | "photos" | "inspectionV1" | "inspectionV2" | "maintenance" | "purchaseAgreement", SyntheticFile> {
  return {
    invoice: {
      key: "invoice",
      type: "DEALER_INVOICE",
      title: "Dealer invoice",
      fileName: "dealer-invoice.pdf",
      contentType: "application/pdf",
      bytes: syntheticPdf("Dealer invoice (synthetic)", ["Seller: Demo CNC Dealer", "Buyer: Demo Manufacturer", ASSET_LINE, "Equipment manufacturer: Demo Machine Works (synthetic)", "This is not a real invoice."]),
    },
    photos: {
      key: "photos",
      type: "EQUIPMENT_PHOTOS",
      title: "Equipment photos",
      fileName: "equipment-photos.png",
      contentType: "image/png",
      bytes: syntheticPhotoSheet(),
    },
    inspectionV1: {
      key: "inspection-v1",
      type: "INSPECTION_REPORT",
      title: "Inspection report",
      fileName: "inspection-report-v1.pdf",
      contentType: "application/pdf",
      bytes: syntheticPdf("Scoped inspection report v1 (synthetic)", [ASSET_LINE, "Scope: CNC machinery (synthetic checklist)", "Spindle section not covered in this version."]),
    },
    inspectionV2: {
      key: "inspection-v2",
      type: "INSPECTION_REPORT",
      title: "Inspection report",
      fileName: "inspection-report-v2.pdf",
      contentType: "application/pdf",
      bytes: syntheticPdf("Scoped inspection report v2 (synthetic)", [ASSET_LINE, "Scope: CNC machinery (synthetic checklist)", "Includes the spindle section requested by the verifier."]),
    },
    maintenance: {
      key: "maintenance",
      type: "MAINTENANCE_SUMMARY",
      title: "Maintenance summary",
      fileName: "maintenance-summary.pdf",
      contentType: "application/pdf",
      bytes: syntheticPdf("Maintenance summary (synthetic)", [ASSET_LINE, "Synthetic service entries only."]),
    },
    purchaseAgreement: {
      key: "purchase-agreement",
      type: "PURCHASE_AGREEMENT",
      title: "Purchase agreement",
      fileName: "purchase-agreement.pdf",
      contentType: "application/pdf",
      bytes: syntheticPdf("Purchase agreement (synthetic)", ["Parties: Demo CNC Dealer and Demo Manufacturer", ASSET_LINE, "Not a legal document."]),
    },
  };
}
