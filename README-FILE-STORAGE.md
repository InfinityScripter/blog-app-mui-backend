# PostgreSQL File Storage System

This document describes how files are stored in PostgreSQL instead of the filesystem.

## Overview

The application now stores uploaded files directly in PostgreSQL as binary data instead of saving them to the filesystem. This approach has several advantages:

1. **Centralized Storage**: Files and their metadata are stored in the same database as other application data.
2. **Simplified Deployment**: No need to manage file system permissions or worry about disk space on the server.
3. **Scalability**: PostgreSQL can handle application data and binary assets in one transactional store for moderate file volumes.
4. **Backup and Replication**: Files are automatically included in database backups and replication.

## API Endpoints

### Upload a File

**Endpoint**: `POST /api/upload`

This endpoint accepts multipart form data with a file field. The file is stored in PostgreSQL and a reference is returned.

**Response**:

```json
{
  "message": "File uploaded successfully",
  "file": {
    "name": "unique-filename.ext",
    "path": "/api/file/file-id",
    "id": "file-id"
  }
}
```

### Retrieve a File

**Endpoint**: `GET /api/file/[id]`

This endpoint retrieves a file from PostgreSQL by its ID and serves it with the appropriate content type.

### Delete a File

**Endpoint**: `DELETE /api/file/delete?id=[id]`

This endpoint deletes a file from PostgreSQL. Only the user who uploaded the file can delete it.

## File Model

Files are stored using the following schema:

```typescript
{
  filename: String,      // Unique filename generated for the file
  originalname: String,  // Original filename as uploaded by the user
  mimetype: String,      // MIME type of the file
  size: Number,          // Size of the file in bytes
  data: Buffer,          // Binary data of the file
  uploadDate: Date,      // Date when the file was uploaded
  userId: String,        // ID of the user who uploaded the file
}
```

## Usage in Posts

When creating or editing a post, the `coverUrl` field should now contain a reference to the file in the format `/api/file/[file-id]` instead of a path to a file on the filesystem.

## Implementation Details

1. Files are uploaded to a temporary location using formidable.
2. The file data is read into memory and stored in PostgreSQL as `BYTEA`.
3. The temporary file is deleted after successful upload.
4. When retrieving a file, the binary data is sent directly from PostgreSQL to the client with the appropriate content type headers.

## Performance Considerations

Storing files in PostgreSQL works well for moderate file sizes. For very large files or high-volume media workloads, consider moving binary storage to S3-compatible object storage and keeping only references in PostgreSQL.
