import type { NextApiRequest, NextApiResponse } from 'next';

import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { MSG } from '@/src/constants/messages';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';

// Matches the upload allow-list — any other stored mimetype is served as an
// opaque download, never inline.
const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.GET) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    await dbConnect();
    const { id } = req.query;

    if (!id || typeof id !== 'string') {
      return res.status(HTTP.BAD_REQUEST).json({ message: 'Invalid file id' });
    }

    const file = await File.findById(id);
    if (!file) {
      return res.status(HTTP.NOT_FOUND).json({ message: 'File not found' });
    }

    // Only ever hand back an allow-listed image content-type, and force
    // nosniff, so a file that somehow slipped past the upload filter can't be
    // sniffed/executed as HTML/JS/SVG (stored-XSS defense). Unknown types fall
    // back to a generic binary + attachment disposition.
    const safeContentType = ALLOWED_IMAGE_TYPES.has(file.mimetype)
      ? file.mimetype
      : 'application/octet-stream';
    const disposition = safeContentType === 'application/octet-stream' ? 'attachment' : 'inline';

    res.setHeader('Content-Type', safeContentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(file.originalname)}"`
    );

    // Send the file data
    res.send(file.data);
  } catch (error) {
    // Route errors through the shared handler-free path: never leak the raw
    // error message to the client (the other routes use sendError for this).
    console.error('[File API]:', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}
