export interface DatabaseInfo {
  name: string;
  tables: number;
  size: number;
  rows: number;
  system: boolean;
}

export interface HealthInfo {
  ok: boolean;
  container: string;
  running: boolean;
  version: string;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default: string;
  extra: string;
  comment: string;
}

export interface TableInfo {
  name: string;
  type: string;
  engine: string;
  rows: number;
  size: number;
  collation: string;
  columns: ColumnInfo[];
}

export interface SchemaInfo {
  name: string;
  tables: TableInfo[];
  routines: { name: string; type: string }[];
  triggers: { name: string; timing: string; event: string; table: string }[];
}

export interface SqlError {
  message: string;
  code?: string;
  state?: string;
}

export interface StatementResult {
  sql: string;
  kind: string;
  ok: boolean;
  skipped?: boolean;
  ms?: number;
  error?: SqlError;
  columns?: string[];
  rows?: (string | null)[][];
  total_rows?: number;
  truncated?: boolean;
  affected?: number;
  insert_id?: number;
}

export interface QueryResult {
  ok: boolean;
  db: string | null;
  statements: StatementResult[];
  ms: number;
  count: number;
}

export interface FileInfo {
  name: string;
  bytes: number;
  mtime: number;
}

export interface Tab {
  id: string;
  title: string;
  sql: string;
  db: string | null;
  file: string | null;
  /** db.tabla de origen: evita duplicar pestañas de la misma vista. */
  origin?: string | null;
  dirty: boolean;
  result: QueryResult | null;
  loading: boolean;
  activeStatement: number;
  error: string | null;
}

export interface RelationEndpoint {
  table: string;
  column: string;
}

export interface RelationInfo {
  name: string;
  from: RelationEndpoint;
  to: RelationEndpoint;
  on_delete: string;
  on_update: string;
}

export interface RelationTable {
  name: string;
  type: string;
  rows: number;
  columns: { name: string; type: string; key: string }[];
}

export interface RelationsPayload {
  db: string;
  tables: RelationTable[];
  relations: RelationInfo[];
}

export interface TableIndex {
  name: string;
  unique: boolean;
  type: string;
  columns: string[];
}

export interface TableTrigger {
  name: string;
  timing: string;
  event: string;
}

export interface TablePage {
  columns: string[];
  rows: (string | null)[][];
  total: number;
  offset: number;
  limit: number;
  order: string;
  direction: "asc" | "desc";
  search: string;
}

export interface TableDetail {
  db: string;
  table: string;
  type: string;
  engine: string;
  rows_estimate: number;
  size: number;
  collation: string;
  comment: string;
  columns: ColumnInfo[];
  indexes: TableIndex[];
  triggers: TableTrigger[];
  ddl: string;
  pk: string[];
  data: TablePage;
}

export interface HistoryEntry {
  id: string;
  sql: string;
  db: string | null;
  at: number;
  ok: boolean;
  ms: number;
}

export type ToastKind = "info" | "success" | "error";

export interface ToastItem {
  id: string;
  text: string;
  kind: ToastKind;
}
