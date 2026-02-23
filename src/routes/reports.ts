import { reportService } from '@services/reportService';
import { Router, Request, Response } from 'express';
import { ReportSection, ALL_SECTIONS } from 'src/types/index';

const VALID_SECTIONS = new Set<ReportSection>(ALL_SECTIONS);

export const reportsRouter = Router();

reportsRouter.post('/generate/:campaignId', async (req: Request, res: Response): Promise<void> => {
  const { campaignId } = req.params;

  // Validate requested sections
  let sections: ReportSection[] | undefined;
  if (req.body?.sections) {
    const invalid = (req.body.sections as string[]).filter((s) => !VALID_SECTIONS.has(s as ReportSection));
    if (invalid.length) {
      res.status(400).json({
        success: false,
        error: `Invalid section(s): ${invalid.join(', ')}`,
        validSections: ALL_SECTIONS,
      });
      return;
    }
    sections = req.body.sections as ReportSection[];
  }

  const validation = await reportService.validateCampaign(campaignId);
  if (!validation.valid) {
    res.status(400).json({ success: false, error: validation.reason });
    return;
  }

  //   logger.info(`Generating: ${validation.name}`, { campaignId, sections: sections ?? 'all' });

  try {
    const report = await reportService.generateCampaignReport({
      campaignId,
      sections,
      externalMetrics: req.body?.externalMetrics,
    });
    console.log(report);
    res.json({ success: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // logger.error('Failed', { campaignId, msg });
    res.status(500).json({ success: false, error: msg });
  }
});
