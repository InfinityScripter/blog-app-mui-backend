import type { NextApiRequest, NextApiResponse } from 'next';

import formidable from 'formidable';
import { verify } from 'jsonwebtoken';

import uuidv4 from 'src/utils/uuidv4';
import dbConnect from '@/src/lib/db';
import { File } from '@/src/models/File';

const JWT_SECRET = process.env.JWT_SECRET || 'secret123';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Connect to the database
    await dbConnect();

    // Verify authentication
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ message: 'Отсутствует токен авторизации' });
    }
    const token = authorization.split(' ')[1];
    let decoded: any;
    try {
      decoded = verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Неверный токен авторизации' });
    }

    const userId = decoded.userId;

    // Create a temporary upload directory for formidable
    const form = formidable({
      keepExtensions: true,
      multiples: false,
    });

    return new Promise<void>((resolve, reject) => {
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
          const fileData = await new Promise<Buffer>((resolveRead, rejectRead) => {
            const fileStream = require('fs').createReadStream(file.filepath);
            const chunks: Buffer[] = [];
            
            fileStream.on('data', (chunk: Buffer) => {
              chunks.push(chunk);
            });
            
            fileStream.on('end', () => {
              resolveRead(Buffer.concat(chunks));
            });
            
            fileStream.on('error', (error: Error) => {
              rejectRead(error);
            });
          });

          // Generate a unique filename
          const uniqueFilename = `${uuidv4()}${file.originalFilename?.substring(file.originalFilename.lastIndexOf('.'))}`;

          // Save file to MongoDB
          const newFile = new File({
            filename: uniqueFilename,
            originalname: file.originalFilename,
            mimetype: file.mimetype,
            size: file.size,
            data: fileData,
            userId: userId,
          });

          await newFile.save();

          // Clean up the temporary file
          require('fs').unlinkSync(file.filepath);

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
