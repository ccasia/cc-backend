import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { Prisma } from '@prisma/client';
import { createAgent, HumanMessage, SystemMessage, tool, Tool } from 'langchain';
import { prisma } from 'src/prisma/prisma';
import * as z from 'zod';

class AIReport {
  static initialize(modelName: string) {
    return createAgent({
      model: new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: 'AIzaSyCUC72dFMT_aUNTZs2-cY_7TyxkdU8UO88',
      }),
      systemPrompt: new SystemMessage('You are a senior software engineer. Explain in short and precise'),
      name: 'cipta',
      tools: [tools, getTableFromDbs],
    });
  }
}

const getTableFromDbs = tool(
  async ({ tableName }) => {
    const data = await prisma.$queryRawUnsafe(`SELECT * FROM "${tableName}" LIMIT 1`);

    return JSON.stringify(data[0]);
  },
  {
    name: 'get_table_names',
    description: 'Get campaign information',
    schema: z.object({
      tableName: z.string(),
    }),
  },
);

const tools = tool(
  async ({ name, limit }) => {
    const data = await prisma.user.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive',
        },
      },
      take: limit,
    });
    return JSON.stringify(data);
  },
  {
    name: 'get_user',
    description: 'Get the user data.',
    schema: z.object({
      name: z.string(),
      limit: z.number(),
    }),
  },
);

const model = AIReport.initialize('gemini-2.5-flash');

async function main() {
  try {
    const response = await model.invoke({
      messages: 'Get campaign information with table names "Campaign" in db and summarize the description.',
    });

    const res = response.messages.filter((i) => i.type === 'tool');

    for (const data of response.messages) {
      if (data.type === 'tool') {
        console.log('TOOL CALLS: ', JSON.parse(data.content as any));
      } else if (data.type === 'ai') {
        console.log('AI MESSAGE: ', data.content);
      }
    }

    // console.log(JSON.parse(res[0].content));
  } catch (error) {
    console.log(error);
  }
}

main();
