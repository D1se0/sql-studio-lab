import CodeMirror from "@uiw/react-codemirror";
import { MySQL, sql } from "@codemirror/lang-sql";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import {
  ChevronDown,
  Copy,
  Database as DbIcon,
  Eraser,
  Loader2,
  Play,
  Save,
  SaveAll,
  Wand2,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { DatabaseInfo, Tab } from "../types";

const studioHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#7dd3fc", fontWeight: "600" },
  { tag: [tags.string, tags.special(tags.string)], color: "#9ae6b4" },
  { tag: [tags.number, tags.bool, tags.null], color: "#fbbf24" },
  { tag: tags.comment, color: "#5f6b80", fontStyle: "italic" },
  { tag: [tags.operator, tags.punctuation], color: "#b7a8ff" },
  { tag: tags.typeName, color: "#5eead4" },
  { tag: [tags.function(tags.variableName), tags.labelName], color: "#93c5fd" },
  { tag: tags.variableName, color: "#e9edf7" },
  { tag: tags.invalid, color: "#fb7185" },
]);

const extensions = [
  sql({ dialect: MySQL }),
  syntaxHighlighting(studioHighlight),
  EditorView.theme({
    "&": { backgroundColor: "transparent" },
    ".cm-content": { caretColor: "#5eead4" },
  }),
];

interface Props {
  tab: Tab;
  databases: DatabaseInfo[];
  onChangeSql: (value: string) => void;
  onChangeDb: (value: string | null) => void;
  onRun: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onFormat: () => void;
  onCopy: () => void;
  onClear: () => void;
  onViewReady: (view: EditorView) => void;
  style?: CSSProperties;
}

export function EditorPane(props: Props) {
  const { tab } = props;

  return (
    <section className="editor-panel panel" style={props.style}>
      <div className="editor-bar">
        <label className="db-select">
          <DbIcon size={14} />
          <select
            value={tab.db ?? ""}
            onChange={(event) => props.onChangeDb(event.target.value || null)}
            data-testid="db-select"
            aria-label="Base de datos de la pestaña"
          >
            <option value="">sin base</option>
            {props.databases.map((db) => (
              <option key={db.name} value={db.name}>
                {db.name}
              </option>
            ))}
          </select>
        </label>

        <span className={`file-chip ${tab.file ? "" : "no-file"}`} data-testid="file-chip">
          {tab.file ? `sql/${tab.file}` : "sin guardar en disco"}
        </span>

        <div className="spacer" />

        <button className="btn subtle" onClick={props.onFormat} title="Formatear el SQL" data-testid="format-btn">
          <Wand2 size={14} /> Formatear
        </button>
        <button className="btn subtle" onClick={props.onCopy} title="Copiar el SQL" data-testid="copy-btn">
          <Copy size={14} /> Copiar
        </button>
        <button className="btn subtle" onClick={props.onClear} title="Vaciar el editor" data-testid="clear-btn">
          <Eraser size={14} /> Limpiar
        </button>
        <button
          className="btn subtle save"
          onClick={props.onSave}
          title="Guardar en sql/ (Ctrl+S)"
          data-testid="save-btn"
        >
          {tab.dirty ? <SaveAll size={14} /> : <Save size={14} />} Guardar
        </button>
        <button
          className="btn subtle icon"
          onClick={props.onSaveAs}
          title="Guardar como… (elegir nombre)"
          data-testid="saveas-btn"
        >
          <ChevronDown size={14} />
        </button>
        <button
          className="btn primary"
          onClick={props.onRun}
          disabled={tab.loading}
          data-testid="run-btn"
          title="Ejecutar (Ctrl+Enter); con texto seleccionado, solo esa parte"
        >
          {tab.loading ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
          Ejecutar
          <kbd>Ctrl ↵</kbd>
        </button>
      </div>

      <div className="cm-host" data-testid="editor">
        <CodeMirror
          value={tab.sql}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={props.onChangeSql}
          onCreateEditor={props.onViewReady}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
            highlightSelectionMatches: true,
            tabSize: 2,
          }}
          placeholder="-- Escribe SQL y pulsa Ctrl + Enter"
        />
      </div>
    </section>
  );
}
