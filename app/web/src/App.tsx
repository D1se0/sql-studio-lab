import type { EditorView } from "@codemirror/view";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { api } from "./api";
import { CommandPalette, type PaletteItem } from "./components/CommandPalette";
import { EditorPane } from "./components/EditorPane";
import { Header } from "./components/Header";
import {
  DropDbModal,
  HelpModal,
  ImportModal,
  NewDbModal,
  OpenFileModal,
  SaveAsModal,
} from "./components/Modals";
import { ResultsPanel } from "./components/ResultsPanel";
import { SchemaMap } from "./components/SchemaMap";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { TableInspector } from "./components/TableInspector";
import { Toasts } from "./components/Toasts";
import { downloadCsv, formatSql, num, sqlFilename } from "./lib/format";
import type {
  DatabaseInfo,
  FileInfo,
  HistoryEntry,
  SchemaInfo,
  Tab,
  ToastItem,
  ToastKind,
} from "./types";

const STORAGE_KEY = "sql-studio:v2";
const HISTORY_KEY = "sql-studio:history";
const TEMPLATE = `-- SQL Studio · 10_SQL_Lab
-- Ctrl + Enter ejecuta (solo la selección si hay texto marcado)
SELECT NOW() AS ahora, VERSION() AS servidor;
`;

const randomId = () =>
  `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function makeTab(index: number, patch: Partial<Tab> = {}): Tab {
  return {
    id: randomId(),
    title: `Consulta ${index}`,
    sql: TEMPLATE,
    db: null,
    file: null,
    origin: null,
    dirty: false,
    result: null,
    loading: false,
    activeStatement: 0,
    error: null,
    ...patch,
  };
}

interface Session {
  tabs: Tab[];
  activeId: string;
}

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (!Array.isArray(parsed.tabs) || parsed.tabs.length === 0) return null;
    const tabs = parsed.tabs.map((tab) => ({
      ...makeTab(1),
      ...tab,
      loading: false,
      result: null,
      error: null,
    }));
    return { tabs, activeId: parsed.activeId ?? tabs[0].id };
  } catch {
    return null;
  }
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry) =>
        entry && typeof entry.sql === "string" && typeof entry.at === "number",
    ).slice(0, 40);
  } catch {
    return [];
  }
}

type ModalKind = null | "import" | "newdb" | "saveas" | "open" | "help" | "dropdb";

export default function App() {
  const session = useRef<Session | null>(loadSession());

  const [tabs, setTabs] = useState<Tab[]>(
    () => session.current?.tabs ?? [makeTab(1)],
  );
  const [activeId, setActiveId] = useState<string>(
    () => session.current?.activeId ?? "",
  );
  const tabsRef = useRef<Tab[]>(tabs);
  const viewRef = useRef<EditorView | null>(null);

  const [databases, setDatabases] = useState<DatabaseInfo[]>([]);
  const [schemas, setSchemas] = useState<Record<string, SchemaInfo>>({});
  const [loadingSchemas, setLoadingSchemas] = useState<string[]>([]);
  const [openDbs, setOpenDbs] = useState<string[]>([]);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ModalKind>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [saveTabId, setSaveTabId] = useState<string>("");
  const [saveName, setSaveName] = useState("");
  const [dropTarget, setDropTarget] = useState<string>("");
  const [importBusy, setImportBusy] = useState(false);
  const [inspector, setInspector] = useState<{ db: string; table: string } | null>(null);
  const [mapDb, setMapDb] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [editorPct, setEditorPct] = useState(56);
  const workRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current, { id, text, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4600);
  }, []);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      /* sin historial si la cuota está llena */
    }
  }, [history]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.id === activeId)) {
      setActiveId(tabs[0]?.id ?? "");
    }
  }, [tabs, activeId]);

  useEffect(() => {
    const payload = {
      activeId,
      tabs: tabs.map((tab) => ({ ...tab, loading: false, result: null, error: null })),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* sesión demasiado grande: seguimos sin persistir */
    }
  }, [tabs, activeId]);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  const patchTab = useCallback(
    (id: string, patch: Partial<Tab> | ((tab: Tab) => Partial<Tab>)) => {
      setTabs((current) =>
        current.map((tab) =>
          tab.id === id
            ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) }
            : tab,
        ),
      );
    },
    [],
  );

  /* ------------------------------------------------------------ catálogo */
  const loadDatabases = useCallback(
    async (notify = false) => {
      setRefreshing(true);
      try {
        const [health, catalog] = await Promise.all([api.health(), api.databases()]);
        setConnected(health.running);
        setDatabases(catalog.databases);
        if (notify) {
          toast(`Catálogo actualizado · ${catalog.databases.length} bases`, "success");
        }
      } catch (problem) {
        setConnected(false);
        if (notify) {
          toast(
            problem instanceof Error ? problem.message : "No se pudo leer el catálogo.",
            "error",
          );
        }
      } finally {
        setRefreshing(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    void loadDatabases();
  }, [loadDatabases]);

  const loadSchema = useCallback(
    async (db: string) => {
      setLoadingSchemas((current) =>
        current.includes(db) ? current : [...current, db],
      );
      try {
        const data = await api.schema(db);
        setSchemas((current) => ({ ...current, [db]: data.schema }));
      } catch (problem) {
        toast(
          `${db}: ${problem instanceof Error ? problem.message : "no se pudo leer el esquema"}`,
          "error",
        );
      } finally {
        setLoadingSchemas((current) => current.filter((name) => name !== db));
      }
    },
    [toast],
  );

  const toggleDb = useCallback(
    (db: string) => {
      setOpenDbs((current) =>
        current.includes(db) ? current.filter((name) => name !== db) : [...current, db],
      );
      if (!schemas[db]) void loadSchema(db);
    },
    [schemas, loadSchema],
  );

  const expandAll = useCallback(() => {
    setOpenDbs(databases.map((db) => db.name));
    databases.forEach((db) => {
      if (!schemas[db.name]) void loadSchema(db.name);
    });
  }, [databases, schemas, loadSchema]);

  const ensureAllSchemas = useCallback(() => {
    databases
      .filter((db) => !db.system && !db.name.startsWith("information_"))
      .forEach((db) => {
        if (!schemas[db.name] && !loadingSchemas.includes(db.name)) {
          void loadSchema(db.name);
        }
      });
  }, [databases, schemas, loadingSchemas, loadSchema]);

  const openMapFor = useCallback(
    (db?: string | null) => {
      const target =
        db ||
        tabsRef.current.find((tab) => tab.id === activeId)?.db ||
        databases.find((item) => !item.system)?.name ||
        databases[0]?.name;
      if (!target) {
        toast("Todavía no hay bases de datos que dibujar.", "info");
        return;
      }
      setMapDb(target);
    },
    [activeId, databases, toast],
  );

  const openPalette = useCallback(() => {
    ensureAllSchemas();
    setPaletteOpen(true);
  }, [ensureAllSchemas]);

  const refreshFiles = useCallback(async () => {
    try {
      const data = await api.files();
      setFiles(data.files);
    } catch {
      /* la lista de ficheros es opcional */
    }
  }, []);

  /* ------------------------------------------------------------- pestañas */
  const addTab = useCallback(() => {
    const tab = makeTab(tabsRef.current.length + 1);
    setTabs((current) => [...current, tab]);
    setActiveId(tab.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    const target = tabsRef.current.find((tab) => tab.id === id);
    if (target?.dirty && !window.confirm(`«${target.title}» tiene cambios sin guardar. ¿Cerrar igualmente?`)) {
      return;
    }
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      return next.length > 0 ? next : [makeTab(1)];
    });
  }, []);

  /* ------------------------------------------------------------- ejecutar */
  const runTab = useCallback(
    async (tabId: string, selectionOnly: boolean) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return;
      let sql = tab.sql;
      const view = viewRef.current;
      if (selectionOnly && view) {
        const { from, to } = view.state.selection.main;
        const selected = view.state.sliceDoc(from, to);
        if (selected.trim()) sql = selected;
      }
      if (!sql.trim()) {
        toast("El editor está vacío.", "info");
        return;
      }
      patchTab(tabId, { loading: true, error: null });
      try {
        const { result } = await api.query(tab.db, sql);
        const preferred = result.statements.findIndex(
          (statement) => statement.ok && (statement.columns || statement.affected !== undefined),
        );
        patchTab(tabId, {
          loading: false,
          result,
          activeStatement: preferred >= 0 ? preferred : 0,
        });
        setHistory((current) =>
          [
            {
              id: `h${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
              sql: sql.slice(0, 8000),
              db: tab.db,
              at: Date.now(),
              ok: result.ok,
              ms: result.ms,
            },
            ...current,
          ].slice(0, 40),
        );
        if (!result.ok) {
          const failure = result.statements.find((statement) => !statement.ok);
          toast(
            `Error ${failure?.error?.code ?? ""}: ${failure?.error?.message ?? "la consulta falló"}`,
            "error",
          );
        }
      } catch (problem) {
        patchTab(tabId, {
          loading: false,
          result: null,
          error: problem instanceof Error ? problem.message : String(problem),
        });
      }
    },
    [patchTab, toast],
  );

  const clearOutput = useCallback(() => {
    if (!activeId) return;
    patchTab(activeId, { result: null, error: null, activeStatement: 0 });
  }, [activeId, patchTab]);

  const exportCsv = useCallback(() => {
    const tab = tabsRef.current.find((item) => item.id === activeId);
    const statement = tab?.result?.statements[tab.activeStatement];
    if (!statement?.columns) {
      toast("No hay resultados tabulares que exportar.", "info");
      return;
    }
    const rows = statement.rows ?? [];
    downloadCsv(tab?.file ?? tab?.title ?? "resultado", statement.columns, rows);
    toast(`CSV exportado · ${rows.length} fila(s)`, "success");
  }, [activeId, toast]);

  /* -------------------------------------------------------------- guardar */
  const saveTab = useCallback(
    async (tabId: string, name?: string) => {
      const tab = tabsRef.current.find((item) => item.id === tabId);
      if (!tab) return;
      const target = name ?? tab.file;
      if (!target) {
        setSaveTabId(tabId);
        setSaveName(sqlFilename(tab.title));
        void refreshFiles();
        setModal("saveas");
        return;
      }
      try {
        const { file } = await api.saveFile(target, tab.sql);
        patchTab(tabId, { file: file.name, title: file.name, dirty: false });
        setModal(null);
        toast(`Guardado en sql/${file.name}`, "success");
        void refreshFiles();
      } catch (problem) {
        toast(
          problem instanceof Error ? problem.message : "No se pudo guardar el archivo.",
          "error",
        );
      }
    },
    [patchTab, refreshFiles, toast],
  );

  const openFile = useCallback(
    async (name: string) => {
      try {
        const data = await api.readFile(name);
        const tab = makeTab(tabsRef.current.length + 1, {
          title: name,
          file: name,
          sql: data.sql,
          dirty: false,
        });
        setTabs((current) => [...current, tab]);
        setActiveId(tab.id);
        setModal(null);
        toast(`Abierto sql/${name}`, "info");
      } catch (problem) {
        toast(
          problem instanceof Error ? problem.message : "No se pudo abrir el archivo.",
          "error",
        );
      }
    },
    [toast],
  );

  /* --------------------------------------------------------- datos / bases */
  const openTableTab = useCallback(
    (db: string, table: string) => {
      const quote = (value: string) => value.replace(/`/g, "``");
      const origin = `${db}.${table}`;
      const existing = tabsRef.current.find((tab) => tab.origin === origin);
      if (existing) {
        setInspector(null);
        setMapDb(null);
        setActiveId(existing.id);
        toast(`«${origin}» ya está abierta en una pestaña.`, "info");
        return;
      }
      const tab = makeTab(tabsRef.current.length + 1, {
        title: origin,
        db,
        origin,
        sql: `SELECT *\nFROM \`${quote(db)}\`.\`${quote(table)}\`\nLIMIT 100;`,
        loading: true,
      });
      setTabs((current) => [...current, tab]);
      setActiveId(tab.id);
      setInspector(null);
      setMapDb(null);
      api
        .preview(db, table)
        .then(({ result }) => patchTab(tab.id, { result, loading: false }))
        .catch((problem: unknown) =>
          patchTab(tab.id, {
            loading: false,
            error: problem instanceof Error ? problem.message : String(problem),
          }),
        );
    },
    [patchTab, toast],
  );

  const recallHistory = useCallback(
    (entry: HistoryEntry) => {
      const target = tabsRef.current.find((tab) => tab.id === activeId) ?? tabsRef.current[0];
      if (!target) return;
      patchTab(target.id, { sql: entry.sql, db: entry.db, dirty: true });
      setActiveId(target.id);
      toast("Consulta recuperada del historial", "info");
    },
    [activeId, patchTab, toast],
  );

  const createDatabase = useCallback(
    async (name: string) => {
      await api.createDatabase(name);
      setModal(null);
      toast(`Base ${name} creada`, "success");
      await loadDatabases();
    },
    [loadDatabases, toast],
  );

  const dropDatabase = useCallback(async () => {
    if (!dropTarget) return;
    try {
      await api.dropDatabase(dropTarget);
      setOpenDbs((current) => current.filter((name) => name !== dropTarget));
      setSchemas((current) => {
        const next = { ...current };
        delete next[dropTarget];
        return next;
      });
      toast(`Base ${dropTarget} eliminada`, "success");
      setModal(null);
      await loadDatabases();
    } catch (problem) {
      toast(
        problem instanceof Error ? problem.message : "No se pudo borrar la base.",
        "error",
      );
    }
  }, [dropTarget, loadDatabases, toast]);

  const runImport = useCallback(
    async (sql: string, db: string, create: boolean) => {
      setImportBusy(true);
      try {
        const { result } = await api.importSql(sql, db, create);
        const preferred = result.statements.findIndex(
          (statement) => statement.ok && statement.columns,
        );
        const tab = makeTab(tabsRef.current.length + 1, {
          title: db ? `Import · ${db}` : "Importación",
          db: db || null,
          sql: sql.slice(0, 60000),
          result,
          activeStatement: preferred >= 0 ? preferred : 0,
        });
        setTabs((current) => [...current, tab]);
        setActiveId(tab.id);
        setModal(null);
        toast(
          `Importadas ${result.count} sentencia(s) en ${Math.round(result.ms)} ms`,
          "success",
        );
        await loadDatabases();
      } catch (problem) {
        toast(
          problem instanceof Error ? problem.message : "La importación falló.",
          "error",
        );
      } finally {
        setImportBusy(false);
      }
    },
    [loadDatabases, toast],
  );

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      {
        id: "new-tab",
        kind: "action",
        label: "Nueva pestaña de consulta",
        hint: "Ctrl+T",
        onSelect: addTab,
      },
      {
        id: "open-map",
        kind: "action",
        label: "Mapa de esquema",
        hint: "Ctrl+Shift+M",
        onSelect: () => openMapFor(),
      },
      {
        id: "open-file",
        kind: "action",
        label: "Abrir un archivo .sql de sql/",
        onSelect: () => {
          void refreshFiles();
          setModal("open");
        },
      },
      {
        id: "import-file",
        kind: "action",
        label: "Importar un .sql",
        onSelect: () => setModal("import"),
      },
      {
        id: "new-db",
        kind: "action",
        label: "Nueva base de datos",
        onSelect: () => setModal("newdb"),
      },
      {
        id: "refresh",
        kind: "action",
        label: "Refrescar el catálogo",
        onSelect: () => {
          void loadDatabases(true);
        },
      },
      {
        id: "help",
        kind: "action",
        label: "Atajos y ayuda",
        onSelect: () => setModal("help"),
      },
    ];

    for (const tab of tabs) {
      items.push({
        id: `tab:${tab.id}`,
        kind: "action",
        label: `Ir a ${tab.file ?? tab.title}`,
        hint: "pestaña abierta",
        onSelect: () => setActiveId(tab.id),
      });
    }

    for (const database of databases) {
      items.push({
        id: `db:${database.name}`,
        kind: "database",
        label: database.name,
        hint: `${num(database.tables)} tablas`,
        meta: database.system ? "sistema" : undefined,
        onSelect: () => openMapFor(database.name),
      });
    }

    for (const [dbName, schema] of Object.entries(schemas)) {
      for (const table of schema.tables) {
        items.push({
          id: `table:${dbName}.${table.name}`,
          kind: "table",
          label: `${dbName}.${table.name}`,
          hint: `${table.type === "VIEW" ? "vista" : "tabla"} · ${num(table.rows)} filas`,
          onSelect: () => setInspector({ db: dbName, table: table.name }),
        });
      }
    }

    for (const entry of history.slice(0, 10)) {
      items.push({
        id: `history:${entry.id}`,
        kind: "history",
        label: entry.sql.replace(/\s+/g, " ").trim().slice(0, 76) || "(consulta vacía)",
        hint: entry.db ?? "sin base",
        meta: entry.ok ? `${Math.round(entry.ms)} ms` : "error",
        onSelect: () => recallHistory(entry),
      });
    }
    return items;
  }, [
    tabs,
    databases,
    schemas,
    history,
    addTab,
    openMapFor,
    refreshFiles,
    loadDatabases,
    recallHistory,
  ]);

  /* ------------------------------------------------------------- atajos */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "p") {
        event.preventDefault();
        openPalette();
      } else if (key === "m" && event.shiftKey) {
        event.preventDefault();
        openMapFor();
      } else if (key === "enter") {
        event.preventDefault();
        if (activeId) void runTab(activeId, true);
      } else if (key === "s") {
        event.preventDefault();
        if (activeId) void saveTab(activeId);
      } else if (key === "t") {
        event.preventDefault();
        addTab();
      } else if (key === "w") {
        event.preventDefault();
        if (activeId) closeTab(activeId);
      } else if (key === "k") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (key === "l") {
        event.preventDefault();
        clearOutput();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    activeId,
    runTab,
    saveTab,
    addTab,
    closeTab,
    clearOutput,
    openPalette,
    openMapFor,
  ]);

  const handleView = useCallback((view: EditorView) => {
    viewRef.current = view;
    if (new URLSearchParams(window.location.search).has("test")) {
      (window as unknown as Record<string, unknown>).__cmView = view;
    }
  }, []);

  /* ---------------------------------------------------------- splitter */
  const onSplitDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onSplitMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !workRef.current) return;
    const rect = workRef.current.getBoundingClientRect();
    const pct = ((event.clientY - rect.top) / rect.height) * 100;
    setEditorPct(Math.min(82, Math.max(24, pct)));
  };
  const onSplitUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const totals = useMemo(
    () => ({
      tables: databases.reduce((sum, db) => sum + db.tables, 0),
      rows: databases.reduce((sum, db) => sum + db.rows, 0),
    }),
    [databases],
  );

  const editorStyle: CSSProperties = {
    flexBasis: `${editorPct}%`,
    flexGrow: 0,
    flexShrink: 0,
  };

  if (!activeTab) return null;

  return (
    <div className="shell" data-testid="app">
      <div className="backdrop">
        <div className="orb orb-a" />
        <div className="orb orb-b" />
        <div className="orb orb-c" />
        <div className="grid-lines" />
      </div>

      <Header
        databases={databases.length}
        tables={totals.tables}
        rows={totals.rows}
        connected={connected}
        refreshing={refreshing}
        onRefresh={() => void loadDatabases(true)}
        onImport={() => setModal("import")}
        onNewDb={() => setModal("newdb")}
        onOpenFile={() => {
          void refreshFiles();
          setModal("open");
        }}
        onMap={() => openMapFor()}
        onPalette={openPalette}
      />

      <div className="layout">
        <Sidebar
          databases={databases}
          schemas={schemas}
          loadingSchemas={loadingSchemas}
          openDbs={openDbs}
          search={search}
          searchRef={searchRef}
          onSearch={setSearch}
          onToggle={toggleDb}
          onCollapseAll={() => setOpenDbs([])}
          onExpandAll={expandAll}
          onInspect={(db, table) => setInspector({ db, table })}
          onOpenTableSql={openTableTab}
          onMap={openMapFor}
          onDropDb={(db) => {
            setDropTarget(db);
            setModal("dropdb");
          }}
          onHelp={() => setModal("help")}
        />

        <div className="work" ref={workRef}>
          <TabBar
            tabs={tabs}
            activeId={activeTab.id}
            onSelect={setActiveId}
            onClose={closeTab}
            onAdd={addTab}
          />

          <EditorPane
            style={editorStyle}
            tab={activeTab}
            databases={databases}
            onChangeSql={(value) => patchTab(activeTab.id, { sql: value, dirty: true })}
            onChangeDb={(value) => patchTab(activeTab.id, { db: value, dirty: true })}
            onRun={() => void runTab(activeTab.id, true)}
            onSave={() => void saveTab(activeTab.id)}
            onSaveAs={() => {
              setSaveTabId(activeTab.id);
              setSaveName(activeTab.file ?? sqlFilename(activeTab.title));
              void refreshFiles();
              setModal("saveas");
            }}
            onFormat={() =>
              patchTab(activeTab.id, (tab) => ({ sql: formatSql(tab.sql), dirty: true }))
            }
            onCopy={() => {
              void navigator.clipboard
                .writeText(activeTab.sql)
                .then(() => toast("SQL copiado al portapapeles", "success"))
                .catch(() => toast("El portapapeles no está disponible.", "error"));
            }}
            onClear={() => patchTab(activeTab.id, { sql: "", dirty: true })}
            onViewReady={handleView}
          />

          <div
            className="splitter"
            role="separator"
            aria-orientation="horizontal"
            onPointerDown={onSplitDown}
            onPointerMove={onSplitMove}
            onPointerUp={onSplitUp}
            title="Arrastra para redimensionar"
          />

          <ResultsPanel
            tab={activeTab}
            onSelectStatement={(index) => patchTab(activeTab.id, { activeStatement: index })}
            onClear={clearOutput}
            onExport={exportCsv}
          />
        </div>
      </div>

      <>
        {modal === "import" && (
          <ImportModal
            databases={databases}
            busy={importBusy}
            onClose={() => setModal(null)}
            onImport={(sql, db, create) => void runImport(sql, db, create)}
          />
        )}
        {modal === "newdb" && (
          <NewDbModal onClose={() => setModal(null)} onCreate={createDatabase} />
        )}
        {modal === "saveas" && (
          <SaveAsModal
            initialName={saveName}
            files={files}
            onClose={() => setModal(null)}
            onSave={(name) => void saveTab(saveTabId, name)}
          />
        )}
        {modal === "open" && (
          <OpenFileModal
            files={files}
            onClose={() => setModal(null)}
            onOpen={(name) => void openFile(name)}
          />
        )}
        {modal === "dropdb" && (
          <DropDbModal
            name={dropTarget}
            onClose={() => setModal(null)}
            onConfirm={() => void dropDatabase()}
          />
        )}
        {modal === "help" && <HelpModal onClose={() => setModal(null)} />}
        {inspector && (
          <TableInspector
            key={`${inspector.db}.${inspector.table}`}
            db={inspector.db}
            table={inspector.table}
            onClose={() => setInspector(null)}
            onOpenSql={openTableTab}
            onToast={toast}
          />
        )}
        {mapDb && (
          <SchemaMap
            key={mapDb}
            databases={databases}
            initialDb={mapDb}
            onClose={() => setMapDb(null)}
            onInspect={(db, table) => {
              setMapDb(null);
              setInspector({ db, table });
            }}
            onOpenSql={openTableTab}
          />
        )}
      </>

      <CommandPalette
        open={paletteOpen}
        items={paletteItems}
        loading={loadingSchemas.length > 0}
        onClose={() => setPaletteOpen(false)}
      />

      <Toasts items={toasts} />
    </div>
  );
}
