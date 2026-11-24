import type {
  DatabaseInfo,
  FileInfo,
  HealthInfo,
  QueryResult,
  RelationsPayload,
  SchemaInfo,
  TableDetail,
  TablePage,
} from "./types";

export class ApiError extends Error {
  code?: string;
  state?: string;
  status: number;

  constructor(message: string, status = 0, code?: string, state?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.state = state;
  }
}

interface ErrorPayload {
  error?: { message?: string; code?: string; state?: string };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError("No se pudo contactar con el servidor local.");
  }
  const data = (await response.json().catch(() => null)) as
    | (T & ErrorPayload)
    | null;
  if (!data) {
    throw new ApiError(`Respuesta no válida del servidor (${response.status}).`, response.status);
  }
  if (!response.ok || data.error) {
    throw new ApiError(
      data.error?.message ?? `Error ${response.status}`,
      response.status,
      data.error?.code,
      data.error?.state,
    );
  }
  return data;
}

interface TableQuery {
  limit?: number;
  offset?: number;
  order?: string;
  dir?: "asc" | "desc";
  q?: string;
}

function tableParams(db: string, table: string, options: TableQuery = {}): string {
  const params = new URLSearchParams({ db, table });
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.order) params.set("order", options.order);
  if (options.dir) params.set("dir", options.dir);
  if (options.q) params.set("q", options.q);
  return params.toString();
}

export const api = {
  health: () => request<HealthInfo>("/api/health"),

  databases: () => request<{ databases: DatabaseInfo[] }>("/api/databases"),

  schema: (db: string) =>
    request<{ schema: SchemaInfo }>(`/api/schema?db=${encodeURIComponent(db)}`),

  query: (db: string | null, sql: string) =>
    request<{ result: QueryResult }>("/api/query", {
      method: "POST",
      body: JSON.stringify({ db, sql }),
    }),

  preview: (db: string, table: string) =>
    request<{ result: QueryResult }>(
      `/api/preview?db=${encodeURIComponent(db)}&table=${encodeURIComponent(table)}&limit=100`,
    ),

  relations: (db: string) =>
    request<{ relations: RelationsPayload }>(
      `/api/relations?db=${encodeURIComponent(db)}`,
    ),

  table: (db: string, table: string, options?: TableQuery) =>
    request<{ table: TableDetail }>(`/api/table?${tableParams(db, table, options)}`),

  tableRows: (db: string, table: string, options?: TableQuery) =>
    request<{ data: TablePage }>(`/api/rows?${tableParams(db, table, options)}`),

  importSql: (sql: string, db: string, create: boolean) =>
    request<{ result: QueryResult }>("/api/import", {
      method: "POST",
      body: JSON.stringify({ sql, db, create }),
    }),

  createDatabase: (name: string) =>
    request<{ result: QueryResult }>("/api/database", {
      method: "POST",
      body: JSON.stringify({ action: "create", name }),
    }),

  dropDatabase: (name: string) =>
    request<{ result: QueryResult }>("/api/database", {
      method: "POST",
      body: JSON.stringify({ action: "drop", name }),
    }),

  files: () => request<{ files: FileInfo[] }>("/api/files"),

  readFile: (name: string) =>
    request<{ name: string; sql: string }>(
      `/api/file?name=${encodeURIComponent(name)}`,
    ),

  saveFile: (name: string, sql: string) =>
    request<{ file: FileInfo }>("/api/file", {
      method: "POST",
      body: JSON.stringify({ name, sql }),
    }),
};
