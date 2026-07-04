// Public kanban DTOs (camelCase). The service lives in src/services/kanban.ts.

export interface Board {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdAt: Date;
}
