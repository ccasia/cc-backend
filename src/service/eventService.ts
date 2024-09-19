import { Event, PrismaClient } from '@prisma/client';
import dayjs from 'dayjs';

const prisma = new PrismaClient();

export const createEventService = async ({ title, description, userId, allDay, start, end, color }: Event) => {
  try {
    const newEvent = await prisma.event.create({
      data: {
        title: title,
        description: description,
        userId: userId,
        allDay: allDay,
        start: dayjs(start).format(),
        end: dayjs(end).format(),
        color: color,
      },
    });
    return newEvent;
  } catch (error) {
    throw new Error(error as any);
  }
};

export const getEvents = async (id: string) => {
  try {
    const events = await prisma.event.findMany({
      where: {
        userId: id,
      },
    });
    return events;
  } catch (error) {
    throw new Error(error as any);
  }
};

export const deleteEventService = async (eventId: string) => {
  try {
    const deletedEvent = await prisma.event.delete({
      where: {
        id: eventId,
      },
    });
    return deletedEvent;
  } catch (error) {
    throw new Error(error as any);
  }
};

export const updateEventService = async (eventId: string, eventData: Event) => {
  const newEventData = {
    ...eventData,
    start: dayjs(eventData.start).format(),
    end: dayjs(eventData.end).format(),
  };
  try {
    const updatedEvent = await prisma.event.update({
      where: {
        id: eventId,
      },
      data: {
        ...newEventData,
      },
    });
    return updatedEvent;
  } catch (error) {
    //console.log(error);
    throw new Error(error as any);
  }
};
