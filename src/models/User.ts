/* eslint-disable max-classes-per-file */
import { dbQuery } from '@/src/lib/db';
import uuidv4 from '@/src/utils/uuidv4';

type UserFilter = {
  _id?: string;
  email?: string;
  googleId?: string;
  isEmailVerified?: boolean;
  passwordResetCode?: string;
  passwordResetExpires?: { $gt: Date };
};

export interface IUser {
  _id: string;
  id: string;
  name: string;
  email: string;
  passwordHash?: string | null;
  googleId?: string | null;
  avatarURL?: string | null;
  isEmailVerified?: boolean;
  emailVerificationCode?: string | null;
  emailVerificationExpires?: Date | null;
  passwordResetCode?: string | null;
  passwordResetExpires?: Date | null;
  lastLogin?: Date | null;
  failedLoginAttempts?: number;
  isLocked?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

type UserRow = {
  avatar_url: string | null;
  created_at: Date;
  email: string;
  email_verification_code: string | null;
  email_verification_expires: Date | null;
  failed_login_attempts: number;
  google_id: string | null;
  id: string;
  is_email_verified: boolean;
  is_locked: boolean;
  last_login: Date | null;
  name: string;
  password_hash: string | null;
  password_reset_code: string | null;
  password_reset_expires: Date | null;
  updated_at: Date;
};

function mapUserRow(row: UserRow) {
  return {
    _id: row.id,
    avatarURL: row.avatar_url,
    createdAt: row.created_at,
    email: row.email,
    emailVerificationCode: row.email_verification_code,
    emailVerificationExpires: row.email_verification_expires,
    failedLoginAttempts: row.failed_login_attempts,
    googleId: row.google_id,
    id: row.id,
    isEmailVerified: row.is_email_verified,
    isLocked: row.is_locked,
    lastLogin: row.last_login,
    name: row.name,
    passwordHash: row.password_hash,
    passwordResetCode: row.password_reset_code,
    passwordResetExpires: row.password_reset_expires,
    updatedAt: row.updated_at,
  };
}

function applyProjection(user: User | null, projection?: string) {
  if (!user || !projection) {
    return user;
  }

  const normalized = projection.trim();

  if (normalized.startsWith('-')) {
    const fieldsToExclude = normalized
      .split(/\s+/)
      .map((field) => field.replace(/^-/, ''))
      .filter(Boolean);

    fieldsToExclude.forEach((field) => {
      delete (user as unknown as Record<string, unknown>)[field];
    });

    return user;
  }

  const fieldsToInclude = normalized
    .split(/\s+/)
    .map((field) => field.replace(/^\+/, ''))
    .filter(Boolean);

  const picked = new User({
    _id: user._id,
    email: user.email,
    name: user.name,
  });

  fieldsToInclude.forEach((field) => {
    (picked as unknown as Record<string, unknown>)[field] = (
      user as unknown as Record<string, unknown>
    )[field];
  });

  return picked;
}

function buildWhere(filter: UserFilter) {
  const clauses: string[] = [];
  const values: unknown[] = [];

  if (filter._id) {
    values.push(filter._id);
    clauses.push(`id = $${values.length}`);
  }

  if (filter.email) {
    values.push(filter.email);
    clauses.push(`email = $${values.length}`);
  }

  if (filter.googleId) {
    values.push(filter.googleId);
    clauses.push(`google_id = $${values.length}`);
  }

  if (typeof filter.isEmailVerified === 'boolean') {
    values.push(filter.isEmailVerified);
    clauses.push(`is_email_verified = $${values.length}`);
  }

  if (filter.passwordResetCode) {
    values.push(filter.passwordResetCode);
    clauses.push(`password_reset_code = $${values.length}`);
  }

  if (filter.passwordResetExpires?.$gt) {
    values.push(filter.passwordResetExpires.$gt);
    clauses.push(`password_reset_expires > $${values.length}`);
  }

  return {
    text: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

class UserQuery {
  private projection?: string;

  constructor(private readonly executor: (projection?: string) => Promise<User | null>) {}

  select(projection: string) {
    this.projection = projection;
    return this;
  }

  async exec() {
    return this.executor(this.projection);
  }

  then<TResult1 = User | null, TResult2 = never>(
    onfulfilled?: ((value: User | null) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return this.exec().then(onfulfilled, onrejected);
  }
}

export default class User implements IUser {
  _id: string;

  avatarURL?: string | null;

  createdAt?: Date;

  email: string;

  emailVerificationCode?: string | null;

  emailVerificationExpires?: Date | null;

  failedLoginAttempts?: number;

  googleId?: string | null;

  id: string;

  isEmailVerified?: boolean;

  isLocked?: boolean;

  lastLogin?: Date | null;

  name: string;

  passwordHash?: string | null;

  passwordResetCode?: string | null;

  passwordResetExpires?: Date | null;

  updatedAt?: Date;

  constructor(data: Partial<IUser>) {
    const id = data._id || data.id || uuidv4();

    this._id = id;
    this.id = id;
    this.name = data.name || '';
    this.email = data.email || '';
    this.passwordHash = data.passwordHash ?? null;
    this.googleId = data.googleId ?? null;
    this.avatarURL = data.avatarURL ?? null;
    this.isEmailVerified = data.isEmailVerified ?? false;
    this.emailVerificationCode = data.emailVerificationCode ?? null;
    this.emailVerificationExpires = data.emailVerificationExpires ?? null;
    this.passwordResetCode = data.passwordResetCode ?? null;
    this.passwordResetExpires = data.passwordResetExpires ?? null;
    this.lastLogin = data.lastLogin ?? null;
    this.failedLoginAttempts = data.failedLoginAttempts ?? 0;
    this.isLocked = data.isLocked ?? false;
    this.createdAt = data.createdAt;
    this.updatedAt = data.updatedAt;
  }

  static create(data: Partial<IUser>) {
    const user = new User(data);
    return user.save();
  }

  static deleteMany(filter: UserFilter = {}) {
    const where = buildWhere(filter);
    const query = `DELETE FROM users ${where.text}`;
    return dbQuery(query, where.values);
  }

  static findById(id: string) {
    return new UserQuery(async (projection) => {
      const result = await dbQuery<UserRow>('SELECT * FROM users WHERE id = $1 LIMIT 1', [id]);
      const user = result.rows[0] ? new User(mapUserRow(result.rows[0])) : null;
      return applyProjection(user, projection);
    });
  }

  static findOne(filter: UserFilter) {
    return new UserQuery(async (projection) => {
      const where = buildWhere(filter);
      const result = await dbQuery<UserRow>(
        `SELECT * FROM users ${where.text} ORDER BY created_at ASC LIMIT 1`,
        where.values
      );
      const user = result.rows[0] ? new User(mapUserRow(result.rows[0])) : null;
      return applyProjection(user, projection);
    });
  }

  async save() {
    const result = await dbQuery<UserRow>(
      `
        INSERT INTO users (
          id,
          name,
          email,
          password_hash,
          google_id,
          avatar_url,
          is_email_verified,
          email_verification_code,
          email_verification_expires,
          password_reset_code,
          password_reset_expires,
          last_login,
          failed_login_attempts,
          is_locked,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          google_id = EXCLUDED.google_id,
          avatar_url = EXCLUDED.avatar_url,
          is_email_verified = EXCLUDED.is_email_verified,
          email_verification_code = EXCLUDED.email_verification_code,
          email_verification_expires = EXCLUDED.email_verification_expires,
          password_reset_code = EXCLUDED.password_reset_code,
          password_reset_expires = EXCLUDED.password_reset_expires,
          last_login = EXCLUDED.last_login,
          failed_login_attempts = EXCLUDED.failed_login_attempts,
          is_locked = EXCLUDED.is_locked,
          updated_at = NOW()
        RETURNING *
      `,
      [
        this._id,
        this.name,
        this.email,
        this.passwordHash ?? null,
        this.googleId ?? null,
        this.avatarURL ?? null,
        this.isEmailVerified ?? false,
        this.emailVerificationCode ?? null,
        this.emailVerificationExpires ?? null,
        this.passwordResetCode ?? null,
        this.passwordResetExpires ?? null,
        this.lastLogin ?? null,
        this.failedLoginAttempts ?? 0,
        this.isLocked ?? false,
      ]
    );

    Object.assign(this, mapUserRow(result.rows[0]));
    return this;
  }
}
