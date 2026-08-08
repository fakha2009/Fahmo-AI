import { z } from "zod";

export const RotationSchema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);

export const CropSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().gt(0).max(1),
    height: z.number().gt(0).max(1),
  })
  .strict();

export const InputManifestItemSchema = z
  .object({
    clientPageId: z.string().min(1).max(100),
    fileIndex: z.number().int().min(0),
    sourcePageNumber: z.number().int().min(1).nullable(),
    finalOrder: z.number().int().min(0),
    rotation: RotationSchema,
    crop: CropSchema.nullable(),
  })
  .strict();

export const InputManifestSchema = z
  .array(InputManifestItemSchema)
  .min(1)
  .max(100)
  .superRefine((items, ctx) => {
    const pageIds = new Set<string>();
    const orders = new Set<number>();
    for (const item of items) {
      if (pageIds.has(item.clientPageId)) {
        ctx.addIssue({
          code: "custom",
          path: [items.indexOf(item), "clientPageId"],
          message: `clientPageId должен быть уникален в рамках запроса: ${item.clientPageId}`,
        });
        return;
      }
      pageIds.add(item.clientPageId);
      if (orders.has(item.finalOrder)) {
        ctx.addIssue({
          code: "custom",
          path: [items.indexOf(item), "finalOrder"],
          message: `finalOrder не должен содержать дублей: ${item.finalOrder}`,
        });
        return;
      }
      orders.add(item.finalOrder);
    }
    for (let expected = 0; expected < items.length; expected += 1) {
      if (!orders.has(expected)) {
        ctx.addIssue({
          code: "custom",
          path: [],
          message: `finalOrder должен быть непрерывным от 0: пропущен ${expected}`,
        });
        return;
      }
    }
  });

export type InputManifestItem = z.infer<typeof InputManifestItemSchema>;
export type InputManifest = z.infer<typeof InputManifestSchema>;
