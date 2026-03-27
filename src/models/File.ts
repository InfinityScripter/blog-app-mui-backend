import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';

export interface IFile {
  _id: string;
  id: string;
  filename: string;
  originalname: string;
  mimetype: string;
  size: number;
  data: Buffer;
  uploadDate: Date;
  userId: string;
  createdAt?: Date;
  updatedAt?: Date;
}

type FileRow = {
  created_at: Date;
  data: Buffer;
  filename: string;
  id: string;
  mimetype: string;
  originalname: string;
  size: number;
  updated_at: Date;
  upload_date: Date;
  user_id: string;
};

function mapFileRow(row: FileRow) {
  return {
    _id: row.id,
    createdAt: row.created_at,
    data: row.data,
    filename: row.filename,
    id: row.id,
    mimetype: row.mimetype,
    originalname: row.originalname,
    size: row.size,
    updatedAt: row.updated_at,
    uploadDate: row.upload_date,
    userId: row.user_id,
  };
}

export class File implements IFile {
  _id: string;

  createdAt?: Date;

  data: Buffer;

  filename: string;

  id: string;

  mimetype: string;

  originalname: string;

  size: number;

  updatedAt?: Date;

  uploadDate: Date;

  userId: string;

  constructor(data: Partial<IFile>) {
    const id = data._id || data.id || uuidv4();

    this._id = id;
    this.id = id;
    this.filename = data.filename || '';
    this.originalname = data.originalname || '';
    this.mimetype = data.mimetype || '';
    this.size = data.size || 0;
    this.data = data.data || Buffer.alloc(0);
    this.uploadDate = data.uploadDate || new Date();
    this.userId = data.userId || '';
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static async findById(id: string) {
    const result = await dbQuery<FileRow>('SELECT * FROM files WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? new File(mapFileRow(result.rows[0])) : null;
  }

  static async findByIdAndDelete(id: string) {
    await dbQuery('DELETE FROM files WHERE id = $1', [id]);
  }

  async save() {
    const result = await dbQuery<FileRow>(
      `
        INSERT INTO files (
          id,
          filename,
          originalname,
          mimetype,
          size,
          data,
          upload_date,
          user_id,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (id) DO UPDATE SET
          filename = EXCLUDED.filename,
          originalname = EXCLUDED.originalname,
          mimetype = EXCLUDED.mimetype,
          size = EXCLUDED.size,
          data = EXCLUDED.data,
          upload_date = EXCLUDED.upload_date,
          user_id = EXCLUDED.user_id,
          updated_at = NOW()
        RETURNING *
      `,
      [
        this._id,
        this.filename,
        this.originalname,
        this.mimetype,
        this.size,
        this.data,
        this.uploadDate,
        this.userId,
      ]
    );

    Object.assign(this, mapFileRow(result.rows[0]));
    return this;
  }
}
