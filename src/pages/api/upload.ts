import type { NextApiRequest, NextApiResponse } from 'next';

import formidable from 'formidable';
import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { MSG } from '@/src/constants/messages';
import { unlink, readFile } from 'node:fs/promises';
import { HTTP, HTTP_METHOD } from '@/src/constants/http';
import { requireAuth } from '@/src/middlewares/require-auth';

import uuidv4 from 'src/utils/uuidv4';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== HTTP_METHOD.POST) {
    return res.status(HTTP.METHOD_NOT_ALLOWED).json({ message: MSG.METHOD_NOT_ALLOWED });
  }

  try {
    // Connect to the database
    await dbConnect();

    const userId = req.user!._id;

    // Create a temporary upload directory for formidable
    const form = formidable({
      keepExtensions: true,
      multiples: false,
    });

    return await new Promise<void>((resolve) => {
      form.parse(req, async (err, fields, files) => {
        if (err) {
          console.error('[Upload API] Form parse error:', err);
          res.status(HTTP.INTERNAL).json({ message: 'Error parsing form data' });
          return resolve();
        }

        const file = files.file?.[0];
        if (!file) {
          res.status(HTTP.BAD_REQUEST).json({ message: 'No file uploaded' });
          return resolve();
        }

        try {
          // Read the file data
          const fileData = await readFile(file.filepath);

          // Generate a unique filename
          const uniqueFilename = `${uuidv4()}${file.originalFilename?.substring(file.originalFilename.lastIndexOf('.'))}`;

          // Save file to PostgreSQL
          const newFile = new File({
            filename: uniqueFilename,
            originalname: file.originalFilename || uniqueFilename,
            mimetype: file.mimetype || 'application/octet-stream',
            size: file.size,
            data: fileData,
            userId,
          });

          await newFile.save();

          // Clean up the temporary file
          await unlink(file.filepath);

          res.status(HTTP.OK).json({
            message: 'File uploaded successfully',
            file: {
              name: uniqueFilename,
              path: `/api/file/${newFile._id}`,
              id: newFile._id,
            },
          });
          return resolve();
        } catch (error) {
          console.error('[Upload API] File processing error:', error);
          res.status(HTTP.INTERNAL).json({ message: 'Error processing file' });
          return resolve();
        }
      });
    });
  } catch (error) {
    console.error('[Upload API]:', error);
    return res.status(HTTP.INTERNAL).json({ message: MSG.INTERNAL });
  }
}

export default requireAuth(handler);
