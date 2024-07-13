import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { time } from 'console';

const prisma = new PrismaClient();

export const getTimelineType = async (req: Request, res: Response) => {
  try {
    const timelines = await prisma.timelineTypeDefault.findMany();

    return res.status(200).json(timelines);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const createNewTimeline = async (req: Request, res: Response) => {
  const { timelineType } = req.body;
  let timelines;
  try {
    for (const item of timelineType) {
      timelines = await prisma.timelineTypeDefault.upsert({
        where: {
          name: item.name,
        },
        update: {
          name: item.name
            .split(' ')
            .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
            .join(' '),
        },
        create: {
          name: item.name
            .split(' ')
            .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
            .join(' '),
        },
      });
    }
    return res.status(200).json({ message: 'Successfully created', timelines });
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const updateOrCreateDefaultTimeline = async (req: Request, res: Response) => {
  const { timeline } = req.body;

  try {
    await prisma.timelineTypeDependencyDefault.deleteMany();
    await prisma.timelineDefault.deleteMany();

    for (const item of timeline) {
      if (item.dependsOn !== 'startDate') {
        const timelineDefault = await prisma.timelineDefault.create({
          data: {
            timelineTypeDefaultId: item.timeline_type.id,
            for: item.for,
            duration: item.duration,
          },
        });

        const dependsOn = await prisma.timelineDefault.findUnique({
          where: {
            timelineTypeDefaultId: item.dependsOn,
          },
        });

        if (dependsOn) {
          await prisma.timelineTypeDependencyDefault.create({
            data: {
              timeline_id: timelineDefault.id,
              dependsOnTimelineId: dependsOn?.id,
            },
          });
        }
      } else {
        const timelineDefault = await prisma.timelineDefault.create({
          data: {
            timelineTypeDefaultId: item.timeline_type.id,
            for: item.for,
            duration: item.duration,
          },
        });
      }
    }
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

export const getDefaultTimeline = async (req: Request, res: Response) => {
  try {
    const timelines = await prisma.timelineDefault.findMany({
      include: {
        timelineType: true,
        dependsOn: {
          include: {
            dependsOnTimeline: true,
          },
        },
      },
    });

    return res.status(200).send(timelines);
  } catch (error) {
    return res.status(400).json(error);
  }
};
