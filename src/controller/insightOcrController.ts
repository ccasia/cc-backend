import fs from 'fs/promises';
import { z } from 'zod';
import { Request, Response } from 'express';
import { prisma } from '@/src/prisma/prisma';
import { uploadImage } from '@configs/cloudStorage.config';
import { extractInsightsFromImage, INSIGHT_OCR_MODEL } from '@services/insightOcrService';
import { getScreenshots, MAX_SCREENSHOTS, removeTempFiles, validateScreenshots } from '@utils/insightScreenshots';

export const extractInsightScreenshots = async (req: Request, res: Response) => {
  const files = getScreenshots(req);

  try {
    const invalid = validateScreenshots(files);
    if (invalid) return res.status(400).json({ message: invalid });

    const aiModel = await prisma.aiModel.findFirst({ where: { userId: req.userId } });
    const apiKey = aiModel?.apiKey || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ message: 'No Gemini API key. Add one in AI Report Configurations.' });
    }

    const images = await Promise.all(
      files.map(async (file) =>
        extractInsightsFromImage({
          apiKey,
          fileName: file.name,
          mimeType: file.mimetype,
          data: await fs.readFile(file.tempFilePath),
        }),
      ),
    );

    const totalCostUsd = images.reduce((sum, image) => sum + image.usage.costUsd, 0);

    return res.status(200).json({ model: INSIGHT_OCR_MODEL, images, totalCostUsd });
  } catch (error) {
    console.error('Insight OCR failed:', error);
    return res.status(500).json({ message: 'Could not read the screenshots.' });
  } finally {
    await removeTempFiles(files);
  }
};

const fieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
  number: z.number().nullable(),
  box: z.array(z.number()).length(4).nullable(),
});

const savePayloadSchema = z.object({
  screenshots: z
    .array(
      z.object({
        fileName: z.string(),
        screen: z.string(),
        fields: z.array(fieldSchema),
        usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), costUsd: z.number() }),
        durationMs: z.number(),
      }),
    )
    .min(1)
    .max(MAX_SCREENSHOTS),
  values: z.record(z.string(), z.union([z.number(), z.string()])),
  conflicts: z.number().int().min(0),
});

export const saveInsightOcrResult = async (req: Request, res: Response) => {
  const files = getScreenshots(req);

  try {
    const invalid = validateScreenshots(files);
    if (invalid) return res.status(400).json({ message: invalid });

    const parsed = savePayloadSchema.safeParse(JSON.parse(req.body?.payload || '{}'));
    if (!parsed.success) return res.status(400).json({ message: 'The extracted data is not valid.' });

    const { screenshots, values, conflicts } = parsed.data;
    if (screenshots.length !== files.length) {
      return res.status(400).json({ message: 'Each screenshot needs its extracted data.' });
    }

    const urls = await Promise.all(files.map((file) => uploadImage(file.tempFilePath, file.name, 'insightOcr')));

    const result = await prisma.insightOcrResult.create({
      data: {
        model: INSIGHT_OCR_MODEL,
        values,
        conflicts,
        screenshots: screenshots.map((screenshot, i) => ({ ...screenshot, url: urls[i] })),
        totalCostUsd: screenshots.reduce((sum, s) => sum + s.usage.costUsd, 0),
        createdById: req.userId as string,
      },
      select: { id: true, createdAt: true },
    });

    return res.status(201).json(result);
  } catch (error) {
    console.error('Saving insight OCR result failed:', error);
    return res.status(500).json({ message: 'Could not save the extracted data.' });
  } finally {
    await removeTempFiles(files);
  }
};
