import { Request, Response } from 'express';
import { Entity, PrismaClient } from '@prisma/client';
import { time } from 'console';
import { Title, saveNotification } from './notificationController';
import { clients, io } from '../server';

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
    // await prisma.timelineTypeDependencyDefault.deleteMany();
    await prisma.timelineDefault.deleteMany();

    await Promise.all(
      timeline.map(async (item: any, index: number) => {
        await prisma.timelineDefault.create({
          data: {
            timelineTypeDefaultId: item.timeline_type.id,
            for: item.for,
            order: index + 1,
            duration: item.duration,
          },
        });
      }),
    );

    const admins = await prisma.user.findMany({
      where: {
        role: 'admin',
      },
    });

    await Promise.all(
      admins.map(async (admin) => {
        const data = await saveNotification({
          userId: admin.id,
          message: 'Default Timeline Is Updated',
          entity: 'Timeline',
        });
        io.to(clients.get(admin.id)).emit('notification', data);
      }),
    );
    return res.status(200).json({ message: 'Successfully updated' });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const getDefaultTimeline = async (req: Request, res: Response) => {
  try {
    const timelines = await prisma.timelineDefault.findMany({
      include: {
        timelineType: true,
      },
    });

    return res.status(200).send(timelines);
  } catch (error) {
    return res.status(400).json(error);
  }
};

export const deleteTimelineType = async (req: Request, res: Response) => {
  const { id } = req.params;
  //console.log(id);
  try {
    await prisma.timelineTypeDefault.delete({
      where: {
        id: id,
      },
    });
    return res.status(200).json({ message: 'Successfully deleted' });
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};

export const createSingleTimelineType = async (req: Request, res: Response) => {
  const { name } = req.body;
  try {
    const newTimelineType = await prisma.timelineTypeDefault.create({
      data: {
        name: name
          .split(' ')
          .map((elem: any) => `${elem[0].toUpperCase()}${elem.slice(1)}`)
          .join(' '),
      },
    });
    return res.status(200).json(newTimelineType);
  } catch (error) {
    //console.log(error);
    return res.status(400).json(error);
  }
};
