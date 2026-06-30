import type { NextApiRequest, NextApiResponse } from 'next';

import { HTTP_METHOD } from '@/src/constants/http';

import cors from 'src/utils/cors';

import { getData, saveData } from 'src/_mock/_event';

// ----------------------------------------------------------------------

function getEvents(req: NextApiRequest, res: NextApiResponse) {
  const data = getData();

  res.status(200).json({
    events: data,
  });
}

// ----------------------------------------------------------------------

function newEvent(req: NextApiRequest, res: NextApiResponse) {
  const { eventData } = req.body;

  const data = getData();

  data.push(eventData);

  saveData(data);

  res.status(200).json({
    event: eventData,
  });
}

// ----------------------------------------------------------------------

function updateEvent(req: NextApiRequest, res: NextApiResponse) {
  const { eventData } = req.body;

  const data = getData();

  const event = data.find((_event) => _event.id === eventData.id);

  if (!event) {
    res.status(404).json({
      message: 'Event not found!',
    });
    return;
  }

  Object.assign(event, eventData);

  saveData(data);

  res.status(200).json({
    event,
  });
}

// ----------------------------------------------------------------------

function deleteEvent(req: NextApiRequest, res: NextApiResponse) {
  const { eventId } = req.body;

  const data = getData();

  const events = data.filter((event) => event.id !== eventId);

  saveData(events);

  res.status(200).json({
    eventId,
  });
}

// ----------------------------------------------------------------------

export default async function allHandler(req: NextApiRequest, res: NextApiResponse) {
  try {
    await cors(req, res);

    switch (req.method) {
      case HTTP_METHOD.GET:
        getEvents(req, res);
        break;
      case HTTP_METHOD.POST:
        newEvent(req, res);
        break;
      case HTTP_METHOD.PUT:
        updateEvent(req, res);
        break;
      case HTTP_METHOD.PATCH:
        deleteEvent(req, res);
        break;
      default:
        res.status(405).json({
          message: 'Method not allowed',
        });
    }
  } catch (error) {
    console.error('[Calendar API]: ', error);
    res.status(500).json({
      message: 'Internal server error',
    });
  }
}
