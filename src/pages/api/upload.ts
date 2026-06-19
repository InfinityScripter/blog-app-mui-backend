import type { NextApiRequest, NextApiResponse } from 'next';

import formidable from 'formidable';
import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';
import { requireAuth } from '@/src/utils/auth';
import { unlink, readFile } from 'node:fs/promises';

import uuidv4 from 'src/utils/uuidv4';

export const config = {
  api: {
    bodyParser: false,
  },
};

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
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
          res.status(500).json({ message: 'Error parsing form data' });
          return resolve();
        }

        const file = files.file?.[0];
        if (!file) {
          res.status(400).json({ message: 'No file uploaded' });
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

          res.status(200).json({
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
          res.status(500).json({ message: 'Error processing file' });
          return resolve();
        }
      });
    });
  } catch (error) {
    console.error('[Upload API]:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}

export default requireAuth(handler);
