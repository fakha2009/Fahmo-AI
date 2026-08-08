import { Readable } from "node:stream";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

export interface MakeImageOptions {
  width?: number;
  height?: number;
  format?: "jpeg" | "png" | "webp";
  background?: string;
  exifOrientation?: number;
}

export async function makeImage(options: MakeImageOptions = {}): Promise<Buffer> {
  const width = options.width ?? 200;
  const height = options.height ?? 100;
  const background = options.background ?? "#3366cc";
  let image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background,
    },
  });
  if (options.exifOrientation !== undefined) {
    image = image.withMetadata({ orientation: options.exifOrientation });
  }
  return image.toFormat(options.format ?? "jpeg").toBuffer();
}

export async function makePdf(pageCount = 3): Promise<Buffer> {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage([300, 400]);
  }
  return Buffer.from(await document.save());
}

export async function makeEncryptedPdf(pageCount = 2): Promise<Buffer> {
  const objects: string[] = [];
  objects.push(`1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj`);
  objects.push(`2 0 obj
<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, i) => `${3 + i} 0 R`).join(" ")}] /Count ${pageCount} >>
endobj`);
  for (let index = 0; index < pageCount; index += 1) {
    objects.push(`${3 + index} 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 100 0 R >>
endobj`);
  }
  objects.push(`100 0 obj
<< /Length 0 >>
stream

endstream
endobj`);
  objects.push(`200 0 obj
<< /Filter /Standard /V 1 /R 2 /O <0000000000000000000000000000000000000000> /U <0000000000000000000000000000000000000000> /P -4 >>
endobj`);
  const body = objects.join("\n");
  const header = "%PDF-1.4\n";
  const trailer = `trailer
<< /Size 201 /Root 1 0 R /Encrypt 200 0 R >>
startxref
${header.length + body.length}
%%EOF`;
  return Buffer.from(header + body + trailer, "ascii");
}

export function makeText(content: string): Buffer {
  return Buffer.from(content, "utf8");
}

export function streamOf(buffer: Buffer): Readable {
  return Readable.from(buffer);
}
