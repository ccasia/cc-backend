import { Request, Response } from 'express';
import { createEventService, deleteEventService, getEvents, updateEventService } from 'src/service/eventService';
import { Event } from '@prisma/client';

// @desc Create Event
// @method POST
export const createEvent = async (req: Request, res: Response) => {
  const userId = req.session.userid;

  if (!userId) {
    console.log('ab');
    return res.status(400).json({ message: 'Not authenticated.' });
  }

  const { title, description, allDay, start, end, color } = req.body.eventData;
  try {
    await createEventService({ title, description, userId, allDay, start, end, color } as Event);
    return res.status(200).json({ message: 'New event is created!' });
  } catch (error) {
    console.log(error);
    return res.status(400).json(error);
  }
};

// @desc Display all events based on user id
// @method GET
export const getAllEvents = async (req: Request, res: Response) => {
  const id = req.session.userid;
  try {
    const events = await getEvents(id as string);
    return res.status(200).json({ events: events });
  } catch (error) {
    return res.status(404).json(error);
  }
};

// @desc Update Event
// @method PUT
export const updateEvent = async (req: Request, res: Response) => {
  const { eventData } = req.body;
  try {
    const updatedEvent = await updateEventService(eventData.id, eventData);
    return res.status(200).json({ message: 'Successfully updated.', updatedEvent });
  } catch (error) {
    return res.status(404).json(error);
  }
};

// @desc Delete Event
// @method PATCH
export const deleteEvent = async (req: Request, res: Response) => {
  const { eventId } = req.body;
  try {
    const deletedEvent = await deleteEventService(eventId);
    return res.status(200).json({ message: 'Successfully deleted.', deletedEvent });
  } catch (error) {
    return res.status(404).json(error);
  }
};
