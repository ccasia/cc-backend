import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Prisma, PrismaClient } from '@prisma/client';
import { createAgent, createMiddleware, SystemMessage, tool, ToolRuntime } from 'langchain';

import { MemorySaver, StateSchema } from '@langchain/langgraph';

import * as z from 'zod';

const prisma = new PrismaClient();

const checkpointer = new MemorySaver();

const CustomState = new StateSchema({
  campaignId: z.string(),
});

class AIReport {
  static initialize(modelName: string) {
    return createAgent({
      model: new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: 'AIzaSyDCkc3tEBAjV9hl_iVxbBt9c5P5kr15qlA',
        streaming: true,
      }),
      systemPrompt: new SystemMessage(`You are a campaign analyst named Cipta.

        You are such a energetic ai model, so reply with energetic vibe!
        
        You have access to two tools:
        get_campaign: For you to get campaign information
        
        If Date is provided, format it to nice date string format.

        If no campaign is found. You can respond "I can't get the campaign data. Sorry".

        If human message is general, then reply with general information.

        Explain in short and precise.
        `),
      name: 'cipta',
      tools: [getCampaignTool],
      contextSchema: z.object({
        campaignId: z.string(),
      }),
      stateSchema: CustomState,
      checkpointer,
    });
  }
}

const getCampaignTool = tool(
  async (_, state) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id: state.context.campaignId },
      include: { campaignBrief: true, creatorAgreement: { select: { user: true } }, insightSnapshots: true },
    });
    return JSON.stringify(campaign);
  },
  {
    name: 'get_campaign',
    description: 'Get a campaing information',
    schema: z.object({}),
  },
);

export const model = AIReport.initialize('gemini-2.5-flash');

// async function main() {
//   try {
//     const response = await model.invoke(
//       {
//         messages: [
//           {
//             role: 'human',
//             content:
//               // 'Get a campaign name Belum and generate a Campaign Summary about 1-5 sentences and calculate the average engagement rate, likes, comments.',
//               'Whats my name ?',
//           },
//         ],
//         userId: 'user_123',
//       },
//       {
//         context: {},
//       },
//     );

//     for (const data of response.messages) {
//       if (data.type === 'tool') {
//         console.log('TOOL CALLS: ', typeof data.content === 'object' ? JSON.parse(data.content as any) : data.content);
//       } else if (data.type === 'ai') {
//         console.log('AI MESSAGE: ', data.content);
//         // console.log('TOKEN USAGE: ', data.response_metadata);
//       }
//     }
//   } catch (error) {
//     console.log(error);
//   }
// }

// main();
