import type { NextApiRequest, NextApiResponse } from 'next';

import fs from 'fs';
import path from 'path';
import formidable from 'formidable';
import { verify } from 'jsonwebtoken';

import uuidv4 from 'src/utils/uuidv4';

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
    // Verify authentication
    const { authorization } = req.headers;
    if (!authorization) {
      return res.status(401).json({ message: 'Отсутствует токен авторизации' });
    }
    const token = authorization.split(' ')[1];
    try {
      verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ message: 'Неверный токен авторизации' });
    }

    const form = formidable({
      uploadDir: path.join(process.cwd(), 'public/uploads'),
      filename: (name, ext, part) => 
        // Генерируем уникальное имя файла с сохранением расширения
         `${uuidv4()}${ext}`
      ,
      keepExtensions: true,
    });

    const [fields, files] = await form.parse(req);
    const file = files.file?.[0];

    if (!file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // Файл уже переименован с уникальным именем (uuidv4), просто перемещаем его в папку uploads
    const newPath = path.join(process.cwd(), 'public/uploads', file.newFilename);
    await fs.promises.rename(file.filepath, newPath);

    return res.status(200).json({
      message: 'File uploaded successfully',
      file: {
        name: file.newFilename,
        path: `/uploads/${file.newFilename}`,
      },
    });
  } catch (error) {
    console.error('[Upload API]:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
