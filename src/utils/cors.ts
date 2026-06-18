import type { NextApiRequest, NextApiResponse } from 'next';

import Cors from 'cors';

// ----------------------------------------------------------------------

type Middleware = (req: NextApiRequest, res: NextApiResponse, next: (result: any) => void) => void;

const initMiddleware = (middleware: Middleware) => (req: NextApiRequest, res: NextApiResponse) =>
  new Promise<void>((resolve, reject) => {
    const origin = req.headers.origin ?? '*';

    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');

    middleware(req, res, (result: any) => {
      if (result instanceof Error) {
        return reject(result);
      }

      return resolve();
    });
  });

// ----------------------------------------------------------------------

// You can read more about the available options here: https://github.com/expressjs/cors#configuration-options
const cors = initMiddleware(
  Cors({
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    origin: true,
  })
);

export default cors;
