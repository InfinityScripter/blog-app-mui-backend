/* eslint-disable max-classes-per-file */
import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';

export interface IReplyComment {
  userAvatar?: string;
  userName?: string;
  id: string;
  userId: string;
  name: string;
  avatarUrl: string;
  message: string;
  tagUser?: string;
  postedAt: Date;
}

export interface IComment {
  id: string;
  userId: string;
  name: string;
  avatarUrl: string;
  message: string;
  postedAt: Date;
  replyComment: IReplyComment[];
}

export interface IFavoritePerson {
  name: string;
  avatarUrl: string;
}

export interface IPost {
  _id: string;
  id: string;
  publish: 'draft' | 'published';
  title: string;
  description: string;
  content: string;
  coverUrl: string;
  tags: string[];
  metaTitle: string;
  metaDescription: string;
  metaKeywords: string[];
  totalViews: number;
  totalShares: number;
  totalComments: number;
  totalFavorites: number;
  favoritePerson: IFavoritePerson[];
  comments: IComment[];
  userId: string;
  author: {
    name: string;
    avatarUrl?: string | null;
  };
  createdAt?: Date;
  updatedAt?: Date;
}

type PostFilter = {
  _id?: string;
  publish?: 'draft' | 'published';
  title?: { $options?: string; $regex: string };
  userId?: string;
};

type PostRow = {
  author: { avatarUrl?: string; name: string };
  comments: IComment[];
  content: string;
  cover_url: string;
  created_at: Date;
  description: string;
  favorite_person: IFavoritePerson[];
  id: string;
  meta_description: string;
  meta_keywords: string[];
  meta_title: string;
  publish: 'draft' | 'published';
  tags: string[];
  title: string;
  total_comments: number;
  total_favorites: number;
  total_shares: number;
  total_views: number;
  updated_at: Date;
  user_id: string;
};

function mapPostRow(row: PostRow): IPost {
  return {
    _id: row.id,
    author: row.author || { name: '' },
    comments: row.comments || [],
    content: row.content || '',
    coverUrl: row.cover_url || '',
    createdAt: row.created_at,
    description: row.description || '',
    favoritePerson: row.favorite_person || [],
    id: row.id,
    metaDescription: row.meta_description || '',
    metaKeywords: row.meta_keywords || [],
    metaTitle: row.meta_title || '',
    publish: row.publish,
    tags: row.tags || [],
    title: row.title,
    totalComments: row.total_comments ?? (row.comments || []).length,
    totalFavorites: row.total_favorites || 0,
    totalShares: row.total_shares || 0,
    totalViews: row.total_views || 0,
    updatedAt: row.updated_at,
    userId: row.user_id,
  };
}

function normalizeComments(comments: IComment[] = []) {
  return comments.map((comment) => ({
    ...comment,
    postedAt: new Date(comment.postedAt),
    replyComment: (comment.replyComment || []).map((reply) => ({
      ...reply,
      postedAt: new Date(reply.postedAt),
    })),
  }));
}

function buildWhere(filter: PostFilter) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filter._id) {
    values.push(filter._id);
    clauses.push(`id = $${values.length}`);
  }

  if (filter.publish) {
    values.push(filter.publish);
    clauses.push(`publish = $${values.length}`);
  }

  if (filter.userId) {
    values.push(filter.userId);
    clauses.push(`user_id = $${values.length}`);
  }

  if (filter.title?.$regex) {
    values.push(`%${filter.title.$regex}%`);
    clauses.push(`LOWER(title) LIKE LOWER($${values.length})`);
  }

  return {
    text: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class PostFindQuery {
  private orderBy = 'created_at ASC';

  constructor(private readonly filter: PostFilter) {}

  sort(sort: Record<string, 1 | -1>) {
    const [field, direction] = Object.entries(sort)[0] || ['createdAt', 1];
    const column = field === 'createdAt' ? 'created_at' : 'updated_at';
    this.orderBy = `${column} ${direction === -1 ? 'DESC' : 'ASC'}`;
    return this;
  }

  async lean() {
    return this.exec(true);
  }

  async exec(asLean = false) {
    const where = buildWhere(this.filter);
    const result = await dbQuery<PostRow>(
      `SELECT * FROM posts ${where.text} ORDER BY ${this.orderBy}`,
      where.values
    );

    const posts = result.rows.map((row) => {
      const mapped = mapPostRow(row);
      return asLean ? mapped : new Post(mapped);
    });

    return posts;
  }

  then<TResult1 = IPost[] | Post[], TResult2 = never>(
    onfulfilled?: ((value: IPost[] | Post[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.exec(false).then(onfulfilled, onrejected);
  }
}

export class Post implements IPost {
  _id: string;

  author: {
    avatarUrl?: string | null;
    name: string;
  };

  comments: IComment[];

  content: string;

  coverUrl: string;

  createdAt?: Date;

  description: string;

  favoritePerson: IFavoritePerson[];

  id: string;

  metaDescription: string;

  metaKeywords: string[];

  metaTitle: string;

  publish: 'draft' | 'published';

  tags: string[];

  title: string;

  totalComments: number;

  totalFavorites: number;

  totalShares: number;

  totalViews: number;

  updatedAt?: Date;

  userId: string;

  constructor(data: Partial<IPost>) {
    const id = data._id || data.id || uuidv4();

    this._id = id;
    this.id = id;
    this.publish = data.publish || 'draft';
    this.title = data.title || '';
    this.description = data.description || '';
    this.content = data.content || '';
    this.coverUrl = data.coverUrl || '';
    this.tags = data.tags || [];
    this.metaTitle = data.metaTitle || '';
    this.metaDescription = data.metaDescription || '';
    this.metaKeywords = data.metaKeywords || [];
    this.totalViews = data.totalViews || 0;
    this.totalShares = data.totalShares || 0;
    this.comments = normalizeComments(data.comments || []);
    this.totalComments =
      data.totalComments ?? (Array.isArray(data.comments) ? data.comments.length : 0);
    this.totalFavorites = data.totalFavorites || 0;
    this.favoritePerson = data.favoritePerson || [];
    this.userId = data.userId || '';
    this.author = data.author || { name: '' };
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: Partial<IPost>) {
    if (!data.title || !data.userId || !data.author?.name) {
      throw new ValidationError('Missing required post fields');
    }

    const post = new Post(data);
    return post.save();
  }

  static async deleteMany() {
    await dbQuery('DELETE FROM posts');
  }

  static find(filter: PostFilter) {
    return new PostFindQuery(filter);
  }

  static async findById(id: string) {
    const result = await dbQuery<PostRow>('SELECT * FROM posts WHERE id = $1 LIMIT 1', [id]);
    return result.rows[0] ? new Post(mapPostRow(result.rows[0])) : null;
  }

  static async findByIdAndDelete(id: string) {
    await dbQuery('DELETE FROM posts WHERE id = $1', [id]);
  }

  static async findByIdAndUpdate(
    id: string,
    updatedFields: Partial<IPost> & { $set?: Partial<IPost> },
    options: { new?: boolean } = {}
  ) {
    const existing = await Post.findById(id);

    if (!existing) {
      return null;
    }

    const normalizedFields = updatedFields.$set || updatedFields;
    Object.assign(existing, normalizedFields);
    await existing.save();

    return options.new ? existing : null;
  }

  static async findOne(filter: PostFilter) {
    const where = buildWhere(filter);
    const result = await dbQuery<PostRow>(
      `SELECT * FROM posts ${where.text} ORDER BY created_at ASC LIMIT 1`,
      where.values
    );
    return result.rows[0] ? new Post(mapPostRow(result.rows[0])) : null;
  }

  static async findOneAndUpdate(
    filter: PostFilter,
    update: { $inc?: { totalViews?: number } },
    options: { new?: boolean } = {}
  ) {
    const post = await Post.findOne(filter);

    if (!post) {
      return null;
    }

    post.totalViews += update.$inc?.totalViews || 0;
    await post.save();

    return options.new ? post : null;
  }

  async save() {
    this.comments = normalizeComments(this.comments);
    this.totalComments = this.comments.length;

    const result = await dbQuery<PostRow>(
      `
        INSERT INTO posts (
          id,
          publish,
          title,
          description,
          content,
          cover_url,
          tags,
          meta_title,
          meta_description,
          meta_keywords,
          total_views,
          total_shares,
          total_comments,
          total_favorites,
          favorite_person,
          comments,
          user_id,
          author,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18::jsonb, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          publish = EXCLUDED.publish,
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          content = EXCLUDED.content,
          cover_url = EXCLUDED.cover_url,
          tags = EXCLUDED.tags,
          meta_title = EXCLUDED.meta_title,
          meta_description = EXCLUDED.meta_description,
          meta_keywords = EXCLUDED.meta_keywords,
          total_views = EXCLUDED.total_views,
          total_shares = EXCLUDED.total_shares,
          total_comments = EXCLUDED.total_comments,
          total_favorites = EXCLUDED.total_favorites,
          favorite_person = EXCLUDED.favorite_person,
          comments = EXCLUDED.comments,
          user_id = EXCLUDED.user_id,
          author = EXCLUDED.author,
          updated_at = NOW()
        RETURNING *
      `,
      [
        this._id,
        this.publish,
        this.title,
        this.description,
        this.content,
        this.coverUrl,
        JSON.stringify(this.tags),
        this.metaTitle,
        this.metaDescription,
        JSON.stringify(this.metaKeywords),
        this.totalViews,
        this.totalShares,
        this.totalComments,
        this.totalFavorites,
        JSON.stringify(this.favoritePerson),
        JSON.stringify(this.comments),
        this.userId,
        JSON.stringify(this.author),
      ]
    );

    Object.assign(this, mapPostRow(result.rows[0]));
    return this;
  }
}
