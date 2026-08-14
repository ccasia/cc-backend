import { HumanMessage, ToolMessage } from '@langchain/core/messages';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Command, LangGraphRunnableConfig, MemorySaver } from '@langchain/langgraph';
import inquirer from 'inquirer';
import {
  createAgent,
  dynamicSystemPromptMiddleware,
  humanInTheLoopMiddleware,
  modelCallLimitMiddleware,
  piiMiddleware,
  providerStrategy,
  ProviderStrategy,
  summarizationMiddleware,
  tool,
  ToolRuntime,
} from 'langchain';

import * as z from 'zod';

import { PrismaClient } from '@prisma/client';
import { log } from 'console';
import { stdout } from 'process';
import { ToolRunnableConfig } from '@langchain/core/tools';
import { createFilesystemMiddleware } from 'deepagents';

const customSchema = z.object({
  username: z.string().optional(),
  name: z.string().optional(),
});

type CustomState = z.infer<typeof customSchema>;

const prisma = new PrismaClient();

const config = { configurable: { thread_id: 1 } };

const model = new ChatGoogleGenerativeAI({
  model: 'gemini-3.5-flash-lite',
  apiKey: process.env.GOOGLE_API_KEY,
  streaming: true,
});

const analytics = tool(
  async ({ query }, config) => {
    const campaign = await prisma.campaign.findMany({
      where: {
        OR: [
          {
            insightSnapshots: {
              some: {},
            },
          },
          {
            manualCreatorEntries: {
              some: {},
            },
          },
        ],
      },
      take: 3,
      select: {
        name: true,
        shortlisted: {
          select: {
            user: {
              select: {
                name: true,
              },
            },
          },
        },
        campaignBrief: true,
        insightSnapshots: true,
        manualCreatorEntries: true,
      },
    });

    const result = await analyticAgent.invoke(
      { messages: [{ role: 'human', content: `Data:\n${JSON.stringify(campaign)}\n\nQuestion: ${query}` }] },
      { configurable: { thread_id: 1 } },
    );

    const last = result.messages.at(-1)?.content;
    return typeof last === 'string' ? last : JSON.stringify(last ?? '');
  },
  {
    name: 'campaign_analytics',
    description: 'Use this tool to get a specific campaign analytics and analyze the data.',
    schema: z.object({
      query: z.string(),
    }),
  },
);

const analyticAgent = createAgent({
  model,
  systemPrompt: `
    You are a campaign analytics specialist.

    Your job is to:
    - Find relevant campaign
    - Extract the analytics data
    - Return consice findings
    `,
  name: 'analytics_agent',
});

const agent = createAgent({
  model,
  systemPrompt: `
    You are the main campaign analyst.

    You can delegate campaign analytics to campaign_analytics subagent when necessary. 
    When a tool returns result, save it to a file with write_file
    (e.g. /campaign_123_raw.json) instead of keeping it all in the conversation.
    Use ls and read_file to pull specific parts back when you need them.
    `,
  name: 'Cipta',
  checkpointer: new MemorySaver(),
  stateSchema: customSchema,
  tools: [analytics],
  middleware: [
    createFilesystemMiddleware({
      customToolDescriptions: {
        ls: 'Use this tool when user ask ls',
      },
      tools: ['ls', 'read_file', 'write_file'],
      permissions: [{ mode: 'allow', operations: ['write'], paths: ['/'] }],
    }),
  ],
});

async function main() {
  const username = await inquirer.prompt({
    name: 'username',
    type: 'select',
    message: 'What is your usersame ?',
    // validate: (message) => {
    //   if (message.length < 1) return 'Username is needed';
    //   return true;
    // },
    choices: ['apikoll', 'afiqdanial'],
    askAnswered: false,
  });

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res = await inquirer.prompt({
        name: 'ai',
        type: 'input',
        message: '',
      });

      if (res.ai === 'bye') {
        const result = await agent.invoke(
          { messages: [{ role: 'human', content: res.ai }] },
          { ...config, context: { username: username.username } },
        );

        const aiMessage = result.messages.at(-1);

        console.log(aiMessage?.content);
        break;
      }

      const stream = await agent.streamEvents(
        {
          messages: [{ role: 'human', content: res.ai }],
          name: 'supervisor',
        },
        { ...config, context: { username: username.username }, version: 'v3' },
      );

      await Promise.all([
        (async () => {
          for await (const message of stream.messages) {
            //   console.log(message);
            //   for await (const tool of message.toolCalls) {
            //     console.log(`Calling ${tool.name}...`);
            //   }
            for await (const text of message.text) {
              for (const char of text) {
                stdout.write(char);
                await new Promise((resolve) => setTimeout(resolve, 20));
              }
            }
          }
        })(),
      ]);

      console.log('\n');
    }
  } catch (error) {
    console.log(error);
  }
}

main()
  .then(async () => {
    console.log('DONE');
    return;
    // await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    // await prisma.$disconnect();
    process.exit(1);
  });
