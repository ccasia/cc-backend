// src/services/reportService.ts
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { RunnableSequence } from '@langchain/core/runnables';

import { createGemini, GEMINI_MODEL } from '../lib/gemini';

import { collectSectionData } from './dataCollector';
import { fetchInstagramCampaignMetrics } from './instagramInsightCollector';

import {
  ReportSection,
  ALL_SECTIONS,
  SectionResult,
  CampaignReportResult,
  GenerateReportRequest,
  ExternalMetrics,
} from '../types/index';
import { prisma } from '@/src/prisma/prisma';

import { getLatestCampaignPostEngagement } from './postEngagementSnapshotService';
import { HumanMessage, SystemMessage } from 'langchain';

// ── Shared format rule ─────────────────────────────────────────────────────────

const FORMAT_RULE = `
OUTPUT FORMAT — follow exactly:
- Write 1–2 short paragraphs of flowing prose. No headers. No bullets. No numbered lists.
- Wrap every key number, percentage, or metric in **double asterisks**: **180K views**, **3.2%**, **12 creators**.
- Declarative, confident sentences. No filler phrases like "it is worth noting".
- Do NOT invent figures. Only use numbers present in the data.
- End with one evaluative or forward-looking sentence.
`.trim();

// ── Per-section prompts ────────────────────────────────────────────────────────

const SECTION_PROMPTS: Record<ReportSection, string> = {
  campaign_summary: `You are an influencer marketing analyst writing a campaign summary for a post-campaign report.
${FORMAT_RULE}

Cover: total views, total engagements, engagement rate vs benchmark (3% is industry standard), ROAS if available, total posts published, credits utilised vs allocated (utilisation rate), and overall verdict.
Example style: "The campaign reached **180K users**, generating **19K engagements** at an engagement rate of **3.2%**, which is above industry benchmarks. With a ROAS of **4.36%**, the campaign met performance expectations."`,

  engagement_interactions: `You are an influencer marketing analyst writing the Engagement & Interactions section of a post-campaign report.
${FORMAT_RULE}

Cover: total engagement, when engagement peaked and what drove it, the posting window, and name the top 3 creators by engagement rate with their rates. Platform breakdown is covered in its own section — don't repeat it here.`,

  views_analysis: `You are an influencer marketing analyst writing the Views Analysis section of a post-campaign report.
${FORMAT_RULE}

Write exactly two short paragraphs:
1. Early view velocity: state earlyViewsPercent — the share of the top creators' views that landed within the first 48 hours of posting — and what that implies (e.g. hooks/content that trigger the algorithm immediately).
2. Platform scale: state which platform in viewsByPlatform drove the most views and its share, then name the single top creator from topViewsCreators by username with their view count as a concrete example.
Example style: "Over **98% of views** across the top creators landed within the first **48 hours** of posting, showing how fast-hook content triggers the algorithm. **TikTok** drove the majority of views (**@aisrdzn** alone brought in **86K views**), confirming it as the dominant platform for reach."`,

  platform_breakdown: `You are an influencer marketing analyst writing the Platform Breakdown section of a post-campaign report.
${FORMAT_RULE}

Cover: how posts, views and engagement split across TikTok vs Instagram, which platform carried more of the campaign's total views (as a share of total), and which platform had the stronger engagement rate. Note if one platform is under-represented in post count relative to its performance. List who has the highest likes and shares in bold`,

  audience_sentiment: `You are an influencer marketing analyst writing the Audience Sentiment section.
${FORMAT_RULE}

Cover: the positive/neutral/negative percentage split, what it indicates about audience reception, the most common negative feedback themes, and whether sentiment reflects strong content-audience alignment.`,

  top_creator_personas: `You are an influencer marketing analyst writing the Top Performing Creator Personas section.
${FORMAT_RULE}

Name the top 2–3 creators explicitly with their key stats (engagement rate, followers, views, approved content count). Describe what made each effective — their niche, content style, or audience fit. End with what creator profile to prioritise in future campaigns.`,

  campaign_recommendations: `You are an influencer marketing analyst writing the Campaign Recommendations section.
${FORMAT_RULE}

Based on the full campaign data, give exactly 3 specific, data-backed recommendations for the next campaign. Each must reference actual figures from the data (e.g. "Given the **3.2% engagement rate** in Week 3..."). Focus areas: creator selection, posting timing, content format, or budget allocation. No generic advice.`,
};

const HUMAN_TEMPLATES: Record<ReportSection, string> = {
  campaign_summary: 'Campaign data:\n\n{data}\n\nWrite the campaign summary now:',
  engagement_interactions: 'Engagement data:\n\n{data}\n\nWrite the Engagement & Interactions paragraph now:',
  platform_breakdown: 'Platform breakdown data:\n\n{data}\n\nWrite the Platform Breakdown paragraph now:',
  views_analysis: 'Views data:\n\n{data}\n\nWrite the Views Analysis paragraph now:',
  audience_sentiment: 'Sentiment data:\n\n{data}\n\nWrite the Audience Sentiment paragraph now:',
  top_creator_personas: 'Creator data:\n\n{data}\n\nWrite the Top Performing Creator Personas paragraph now:',
  campaign_recommendations: 'Full campaign context:\n\n{data}\n\nWrite the 3 Campaign Recommendations now:',
};

// ── Chain runner ──────────────────────────────────────────────────────────────
async function runSectionChain(section: ReportSection, data: Record<string, unknown>, userId: string): Promise<string> {
  const result = await prisma.aiModel.findFirst({ where: { userId } });

  const dbSections = result?.systemPrompt as unknown as Record<ReportSection, string> | undefined;

  const systemPrompt = dbSections?.[section] || SECTION_PROMPTS[section];

  const prompt = ChatPromptTemplate.fromMessages([
    new SystemMessage(systemPrompt),

    ['human', HUMAN_TEMPLATES[section]],
  ]);

  const chain = RunnableSequence.from([prompt, await createGemini(result ?? undefined), new StringOutputParser()]);

  return chain.invoke({ data: JSON.stringify(data, null, 2) });
}

// ── Main service ──────────────────────────────────────────────────────────────

export class ReportService {
  async generateCampaignReport(req: GenerateReportRequest): Promise<CampaignReportResult> {
    const t0 = Date.now();
    const sections = req.sections ?? ALL_SECTIONS;
    const { campaignId } = req;
    let { externalMetrics } = req;

    // Auto-fetch live Instagram metrics from Meta API, merged with any caller-supplied overrides
    try {
      const liveMetrics = await fetchInstagramCampaignMetrics(campaignId);

      externalMetrics = {
        summary: { ...liveMetrics.summary, ...externalMetrics?.summary },
        engagement: { ...liveMetrics.engagement, ...externalMetrics?.engagement },
        views: { ...liveMetrics.views, ...externalMetrics?.views },
        sentiment: externalMetrics?.sentiment,
        creators: externalMetrics?.creators ?? liveMetrics.creators,
      };
    } catch (err) {
      console.warn('[ReportService] Instagram live fetch failed, falling back to snapshots:', (err as Error).message);
    }

    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { campaignBrief: true, brand: { select: { name: true } } },
    });

    if (!campaign.campaignBrief) {
      throw new Error(`Campaign "${campaign.name}" has no CampaignBrief.`);
    }

    // 1. Collect non-recommendations sections in parallel
    const nonRecSections = sections.filter((s) => s !== 'campaign_recommendations');

    const collectedEntries: { section: ReportSection; data: Record<string, unknown> }[] = await Promise.all(
      nonRecSections.map(async (section) => ({
        section: section as ReportSection,
        data: await collectSectionData(section, campaignId, externalMetrics),
      })),
    );

    // 2. Build combined context for recommendations
    const allSectionData: Record<string, unknown> = {};
    for (const { section, data } of collectedEntries) {
      allSectionData[section] = data;
    }

    if (sections.includes('campaign_recommendations')) {
      const recData = await collectSectionData('campaign_recommendations', campaignId, externalMetrics, allSectionData);
      collectedEntries.push({ section: 'campaign_recommendations', data: recData });
    }

    // 3. Generate Gemini summaries in parallel
    const sectionResults: SectionResult[] | any = await Promise.all(
      collectedEntries.map(async ({ section, data }) => {
        const summaryData = section === 'campaign_recommendations' ? allSectionData : data;

        const summary = await runSectionChain(section, summaryData, req.userId);

        return { section, summary: summary, data };
      }),
    );

    const durationMs = Date.now() - t0;

    return {
      campaignId,
      campaignName: campaign.name,
      geminiModel: GEMINI_MODEL,
      period: {
        startDate: campaign.campaignBrief.startDate,
        endDate: campaign.campaignBrief.endDate,
      },
      sections: sectionResults,
      durationMs,
      createdAt: new Date(),
    };
  }

  async validateCampaign(campaignId: string) {
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      include: { campaignBrief: { select: { startDate: true, endDate: true } } },
    });
    if (!campaign) return { valid: false, reason: `Campaign "${campaignId}" not found.` };
    if (!campaign.campaignBrief) return { valid: false, name: campaign.name, reason: 'No CampaignBrief set.' };
    return { valid: true, name: campaign.name };
  }
}

export const reportService = new ReportService();
