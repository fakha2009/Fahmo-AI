import sharp from "sharp";
import { AppError } from "../../../shared/errors";
import { sha256Hex } from "../../../shared/utils/hash";

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageProcessInput {
  buffer: Buffer;
  rotation: 0 | 90 | 180 | 270;
  crop: ImageCrop | null;
}

export interface ImageProcessResult {
  buffer: Buffer;
  width: number;
  height: number;
  sha256: string;
}

export class ImageProcessor {
  async process(input: ImageProcessInput): Promise<ImageProcessResult> {
    let metadata;
    try {
      metadata = await sharp(input.buffer).metadata();
    } catch (error) {
      throw new AppError({
        code: "CORRUPTED_FILE",
        message: "Не удалось прочитать изображение",
        cause: error,
      });
    }
    if (metadata.width === undefined || metadata.height === undefined) {
      throw new AppError({ code: "CORRUPTED_FILE", message: "Изображение не содержит размеров" });
    }

    const swapDimensions = input.rotation % 180 !== 0;
    let width = metadata.width;
    let height = metadata.height;
    if (swapDimensions) {
      [width, height] = [height, width];
    }

    let pipeline = sharp(input.buffer).autoOrient().rotate(input.rotation);

    if (input.crop !== null) {
      const crop = this.toPixelCrop(input.crop, width, height);
      pipeline = pipeline.extract(crop);
    }

    let buffer: Buffer;
    try {
      buffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
    } catch (error) {
      throw new AppError({
        code: "CORRUPTED_FILE",
        message: "Не удалось обработать изображение",
        cause: error,
      });
    }

    const output = await sharp(buffer).metadata();
    return {
      buffer,
      width: output.width ?? width,
      height: output.height ?? height,
      sha256: sha256Hex(buffer),
    };
  }

  private toPixelCrop(
    crop: ImageCrop,
    width: number,
    height: number
  ): { left: number; top: number; width: number; height: number } {
    const left = Math.round(crop.x * width);
    const top = Math.round(crop.y * height);
    const cropWidth = Math.round(crop.width * width);
    const cropHeight = Math.round(crop.height * height);
    if (
      left < 0 ||
      top < 0 ||
      cropWidth <= 0 ||
      cropHeight <= 0 ||
      left + cropWidth > width ||
      top + cropHeight > height
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Некорректная область crop",
        params: { left, top, width: cropWidth, height: cropHeight, imageWidth: width, imageHeight: height },
      });
    }
    return { left, top, width: cropWidth, height: cropHeight };
  }
}
