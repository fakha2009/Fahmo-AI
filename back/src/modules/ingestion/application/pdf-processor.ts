import { PDFDocument } from "pdf-lib";
import { AppError } from "../../../shared/errors";

export interface PdfAnalysis {
  pageCount: number;
  isEncrypted: boolean;
}

export class PdfProcessor {
  async analyze(buffer: Buffer): Promise<PdfAnalysis> {
    let document: PDFDocument;
    try {
      document = await PDFDocument.load(buffer, { ignoreEncryption: true });
    } catch (error) {
      throw new AppError({
        code: "CORRUPTED_FILE",
        message: "Не удалось разобрать PDF",
        cause: error,
      });
    }
    if (document.isEncrypted) {
      throw new AppError({
        code: "PDF_PASSWORD_PROTECTED",
        message: "PDF защищён паролем и не может быть обработан",
      });
    }
    let pageCount: number;
    try {
      pageCount = document.getPageCount();
    } catch (error) {
      throw new AppError({
        code: "CORRUPTED_FILE",
        message: "Не удалось прочитать страницы PDF",
        cause: error,
      });
    }
    if (pageCount === 0) {
      throw new AppError({ code: "CORRUPTED_FILE", message: "PDF не содержит страниц" });
    }
    return { pageCount, isEncrypted: false };
  }
}
