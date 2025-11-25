"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef, ReactNode, CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { DataTable, DataRecord } from "../../components/ui/DataTable";
import { Modal } from "../../components/ui/Modal";

type DBResultMeta = {
  sql?: string | null;
  rowCount: number;
  summary?: string | null;
  detail?: string | null;
  highlights: string[];
  columns: string[];
  sampleRows: DataRecord[];
};

type SqlPreviewData = {
  sql: string;
  columns: string[];
  rows: DataRecord[];
  rowCount: number;
};

type Msg = {
  id: string;
  role: "user" | "bot";
  text: string;
  loading?: boolean;
  dbResult?: DBResultMeta;
};

export default function ChatPage() {
  const msgIdRef = useRef(0);
  const createMsg = (
    role: Msg["role"],
    text: string,
    extra?: Partial<Pick<Msg, "loading" | "dbResult">>,
  ): Msg => ({
    id: `msg-${msgIdRef.current++}`,
    role,
    text,
    loading: extra?.loading,
    dbResult: extra?.dbResult,
  });

  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>(() => [
    createMsg("bot", "Hi! How may i assist you?"),
  ]);
  const [sqlModal, setSqlModal] = useState<{
    open: boolean;
    meta?: DBResultMeta;
    data?: SqlPreviewData;
    loading: boolean;
    error?: string;
    sqlText?: string;
  }>({ open: false, loading: false });

  // autosize textarea + altura del dock
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const resize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "0px";
    const next = Math.min(220, ta.scrollHeight);
    ta.style.height = next + "px";
    document.documentElement.style.setProperty("--dock-h", next + 40 + "px");
  };
  useEffect(resize, []);
  useEffect(resize, [input]);

  // autoscroll del board
  const boardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    boardRef.current?.scrollTo({ top: boardRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const ask = async () => {
    const q = input.trim();
    if (!q) return;
    const userMessage = createMsg("user", q);
    const loadingMessage = createMsg("bot", "", { loading: true });
    setMsgs((m) => [...m, userMessage, loadingMessage]);
    setInput("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const message = `Error: ${err?.error ?? "No disponible"}`;
        setMsgs((m) =>
          m.map((msg) =>
            msg.id === loadingMessage.id ? { ...msg, loading: false, text: message } : msg,
          ),
        );
        return;
      }
      const data = await res.json();
      const text = typeof data?.answer === "string" ? data.answer : "Sin respuesta.";
      const dbMeta = normalizeDbResult(data?.db_result);
      setMsgs((m) =>
        m.map((msg) =>
          msg.id === loadingMessage.id
            ? { ...msg, loading: false, text, dbResult: dbMeta }
            : msg,
        ),
      );
    } catch (error) {
      console.error("[chat] fetch error", error);
      setMsgs((m) =>
        m.map((msg) =>
          msg.id === loadingMessage.id
            ? { ...msg, loading: false, text: "Error de red." }
            : msg,
        ),
      );
    }
  };

  const handleOpenSqlModal = (meta: DBResultMeta) => {
    if (!meta.sql) return;
    setSqlModal({
      open: true,
      meta,
      sqlText: meta.sql ?? "",
      loading: true,
      data: undefined,
      error: undefined,
    });
    (async () => {
      try {
        const res = await fetch("/api/sql-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: meta.sql }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          const detail = payload?.detail ?? "No se pudo recuperar la tabla completa.";
          setSqlModal((prev) => ({ ...prev, loading: false, error: detail }));
          return;
        }
        const normalized = normalizePreviewResponse(payload);
        setSqlModal((prev) => ({ ...prev, loading: false, data: normalized, error: undefined }));
      } catch (error) {
        console.error("[chat] sql preview fetch error", error);
        setSqlModal((prev) => ({
          ...prev,
          loading: false,
          error: "Ocurrió un error al consultar la tabla.",
        }));
      }
    })();
  };

  const handleRunEditedSql = async () => {
    const sql = (sqlModal.sqlText ?? "").trim();
    if (!sql) return;
    setSqlModal((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const res = await fetch("/api/sql-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = payload?.detail ?? "No se pudo ejecutar la consulta.";
        setSqlModal((prev) => ({ ...prev, loading: false, error: detail }));
        return;
      }
      const normalized = normalizePreviewResponse(payload);
      setSqlModal((prev) => ({
        ...prev,
        loading: false,
        data: normalized,
        meta: prev.meta ? { ...prev.meta, sql, rowCount: normalized.rowCount } : prev.meta,
        error: undefined,
      }));
    } catch (error) {
      console.error("[chat] run sql fetch error", error);
      setSqlModal((prev) => ({ ...prev, loading: false, error: "Error de red ejecutando SQL." }));
    }
  };

  const onSubmitDock = (e: React.FormEvent) => {
    e.preventDefault();
    ask();
  };

  return (
    <main id="lucai-app" className="min-h-screen pb-[var(--dock-h,120px)] relative">
      {/* HEX super zoom para chat */}
      <div className="hex-zoomed hex-zoomed--chat" aria-hidden />

      {/* HEADER */}
      <header className="header-dark">
        <div className="max-w-6xl mx-auto flex items-center justify-between px-4 py-4">
          {/* logo LUCAI → sitio */}
          <a
            href="https://lucai.bio/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Ir a lucai.bio"
          >
            <Image
              src="/brand/logo.png"
              alt="LUCAI"
              width={180}
              height={40}
              className="brand-logo"
              priority
            />
          </a>

          {/* esfera → Home (/). Si preferís /home, cambiá href */}
          <Link href="/" aria-label="Volver a la Home">
            <Image
              src="/brand/pelota-luca.png"
              alt=""
              width={120}
              height={120}
              className="brand-sphere"
              priority
            />
          </Link>
        </div>
      </header>
      <div className="h-[68px]" />

      {/* THREAD */}
      <section className="max-w-6xl mx-auto p-6 space-y-6">
        <div ref={boardRef} className="card-dark chat-board">
          <div className="chat-thread" aria-live="polite">
            {msgs.map((m) => (
              <div
                key={m.id}
                className={`bubble ${m.role === "user" ? "bubble-user" : "bubble-bot"}`}
                onClick={() => {
                  if (m.role === "bot" && m.dbResult?.sql && !m.loading) {
                    handleOpenSqlModal(m.dbResult);
                  }
                }}
                role={m.role === "bot" && m.dbResult?.sql ? "button" : undefined}
                aria-label={m.role === "bot" && m.dbResult?.sql ? "Ver tabla completa" : undefined}
                style={m.role === "bot" && m.dbResult?.sql ? { cursor: "pointer" } : undefined}
              >
                {m.role === "user" ? (
                  <p className="bubble-text bubble-text-user">{m.text}</p>
                ) : (
                  <div className="bubble-content">
                    {renderBotMessage(m)}
                    {!m.loading && m.dbResult?.sql ? (
                      <button
                        type="button"
                        className="bubble-action"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenSqlModal(m.dbResult!);
                        }}
                      >
                        Ver tabla completa{m.dbResult.rowCount ? ` (${m.dbResult.rowCount} filas)` : ""}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* INPUT DOCK */}
      <div className="input-dock">
        <form
          onSubmit={onSubmitDock}
          className="max-w-6xl mx-auto px-4 pb-3 relative"
          style={{ "--send-w": "72px" } as CSSProperties} // padding-right del textarea
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={resize}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask();
              }
            }}
            rows={1}
            placeholder="Write your message..."
            className="pill-textarea dock-textarea resize-none w-full"
            autoFocus
          />

          {/* Send SOLO TEXTO (sin borde) */}
          <button
            type="submit"
            className="send-text"
            disabled={!input.trim()}
          >
            Send
          </button>
        </form>
      </div>
      <Modal
        open={sqlModal.open}
        onOpenChange={(open) => {
          if (!open) {
            setSqlModal((prev) => ({ ...prev, open: false }));
          }
        }}
        title={
          sqlModal.meta?.sql
            ? `SQL UTILIZADA: ${sqlModal.meta.sql}`
            : "SQL UTILIZADA"
        }
        footer={
          sqlModal.meta ? (
            <div className="lu-modal-footer-meta">
              <span>{sqlModal.meta.rowCount ?? sqlModal.data?.rowCount ?? 0} filas totales</span>
              <span>{sqlModal.meta.sql ? sqlModal.meta.sql.trim() : "Consulta ejecutada"}</span>
            </div>
          ) : undefined
        }
      >
        {sqlModal.meta?.summary ? (
          <p className="lu-modal-summary">{sqlModal.meta.summary}</p>
        ) : null}
        <div className="lu-modal-editor" style={{ "--sql-send-w": "104px" } as CSSProperties}>
          <textarea
            value={sqlModal.sqlText ?? sqlModal.data?.sql ?? sqlModal.meta?.sql ?? ""}
            onChange={(e) => setSqlModal((prev) => ({ ...prev, sqlText: e.target.value }))}
            className="pill-textarea lu-sql-textarea"
            spellCheck={false}
            aria-label="SQL utilizada"
          />
          <button
            type="button"
            className="lu-sql-execute"
            onClick={handleRunEditedSql}
            disabled={sqlModal.loading || !(sqlModal.sqlText ?? "").trim()}
          >
            {sqlModal.loading ? "Ejecutando…" : "Ejecutar"}
          </button>
        </div>
        {sqlModal.error ? <p className="lu-modal-error">{sqlModal.error}</p> : null}
        <div className="lu-modal-table">
          {sqlModal.loading ? (
            <div className="bubble-loading" aria-live="polite">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <DataTable
              columns={
                sqlModal.data?.columns ??
                sqlModal.meta?.columns ??
                (sqlModal.meta?.sampleRows[0] ? Object.keys(sqlModal.meta.sampleRows[0]) : [])
              }
              rows={sqlModal.data?.rows ?? sqlModal.meta?.sampleRows ?? []}
            />
          )}
        </div>
      </Modal>
    </main>
  );
}

const SQL_INDICATOR_REGEX = /sql utilizada:/i;

function renderBotMessage(message: Msg) {
  if (message.loading) {
    return (
      <div className="bubble-loading" role="status" aria-live="polite" aria-label="Generando respuesta">
        <span />
        <span />
        <span />
      </div>
    );
  }

  const cleaned = message.text?.trim();
  if (!cleaned) return <p className="bubble-text">Sin respuesta.</p>;

  if (SQL_INDICATOR_REGEX.test(cleaned)) {
    return renderSqlMessage(cleaned);
  }

  return (
    <div className="bubble-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

const mergeClassName = (base: string, incoming?: string) =>
  incoming ? `${base} ${incoming}` : base;

type MarkdownCodeProps = ComponentPropsWithoutRef<"code"> & {
  inline?: boolean;
  node?: unknown;
};

const markdownComponents: Components = {
  h1({ className, ...props }) {
    return <h2 className={mergeClassName("bubble-heading", className)} {...props} />;
  },
  h2({ className, ...props }) {
    return <h3 className={mergeClassName("bubble-heading", className)} {...props} />;
  },
  h3({ className, ...props }) {
    return <h4 className={mergeClassName("bubble-heading", className)} {...props} />;
  },
  h4({ className, ...props }) {
    return <h5 className={mergeClassName("bubble-heading", className)} {...props} />;
  },
  p({ className, ...props }) {
    return <p className={mergeClassName("bubble-text", className)} {...props} />;
  },
  ul({ className, ...props }) {
    return <ul className={mergeClassName("bubble-list", className)} {...props} />;
  },
  ol({ className, ...props }) {
    return <ol className={mergeClassName("bubble-ordered-list", className)} {...props} />;
  },
  li({ className, ...props }) {
    return <li className={mergeClassName("bubble-list-item", className)} {...props} />;
  },
  blockquote({ className, ...props }) {
    return <blockquote className={mergeClassName("bubble-blockquote", className)} {...props} />;
  },
  code({ inline, className, children, ...props }: MarkdownCodeProps) {
    if (inline) {
      const cls = ["bubble-inline-code", className].filter(Boolean).join(" ");
      return (
        <code className={cls} {...props}>
          {children}
        </code>
      );
    }

    return (
      <pre className="bubble-code">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    );
  },
  a({ className, ...props }) {
    return (
      <a
        className={mergeClassName("bubble-link", className)}
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    );
  },
  table({ className, ...props }) {
    return (
      <div className="bubble-table-wrapper">
        <table className={className} {...props} />
      </div>
    );
  },
  th({ className, ...props }) {
    return <th className={mergeClassName("bubble-table-header", className)} {...props} />;
  },
  td({ className, ...props }) {
    return <td className={mergeClassName("bubble-table-cell", className)} {...props} />;
  },
};

function renderSqlMessage(text: string) {
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const elements: ReactNode[] = [];

  const pushDetailLines = (block: string, keyPrefix: string) => {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const listItems: string[] = [];
    let listIndex = 0;

    const flushList = () => {
      if (!listItems.length) return;
      elements.push(
        <ul className="bubble-list" key={`${keyPrefix}-list-${listIndex}`}>
          {listItems.map((item, idx) => (
            <li key={idx}>{item}</li>
          ))}
        </ul>,
      );
      listItems.length = 0;
      listIndex += 1;
    };

    lines.forEach((line, idx) => {
      if (line.startsWith("- ")) {
        listItems.push(line.replace(/^-+\s*/, ""));
        return;
      }

      flushList();

      if (/^sql utilizada:/i.test(line)) {
        elements.push(
          <pre className="bubble-code" key={`${keyPrefix}-sql-${idx}`}>
            {line.replace(/^sql utilizada:\s*/i, "")}
          </pre>,
        );
        return;
      }

      if (/^pasos ejecutados:/i.test(line)) {
        elements.push(
          <p className="bubble-text bubble-steps" key={`${keyPrefix}-steps-${idx}`}>
            <span className="bubble-steps-label">Pasos ejecutados:</span>{" "}
            {line.replace(/^pasos ejecutados:\s*/i, "")}
          </p>,
        );
        return;
      }

      elements.push(
        <p className="bubble-text" key={`${keyPrefix}-line-${idx}`}>
          {line}
        </p>,
      );
    });

    flushList();
  };

  blocks.forEach((block, idx) => {
    if (idx === 0 && !block.startsWith("- ")) {
      elements.push(
        <p className="bubble-text bubble-summary" key={`summary-${idx}`}>
          {block}
        </p>,
      );
      return;
    }

    pushDetailLines(block, `detail-${idx}`);
  });

  return elements.length ? elements : <p className="bubble-text">Sin respuesta.</p>;
}

function normalizeDbResult(payload: unknown): DBResultMeta | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const highlights = Array.isArray(record.highlights) ? record.highlights.map(String) : [];
  const columns = Array.isArray(record.columns) ? record.columns.map(String) : [];
  const sampleRows = Array.isArray(record.sample_rows)
    ? (record.sample_rows as DataRecord[])
    : [];
  const rowCountValue =
    typeof record.row_count === "number"
      ? record.row_count
      : typeof record.rowCount === "number"
        ? (record.rowCount as number)
        : sampleRows.length;

  return {
    sql: typeof record.sql === "string" ? record.sql : undefined,
    rowCount: rowCountValue,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    detail: typeof record.detail === "string" ? record.detail : undefined,
    highlights,
    columns,
    sampleRows,
  };
}

function normalizePreviewResponse(payload: unknown): SqlPreviewData {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const columns = Array.isArray(record.columns) ? record.columns.map(String) : [];
  const rows = Array.isArray(record.rows) ? (record.rows as DataRecord[]) : [];
  const rowCount =
    typeof record.row_count === "number"
      ? record.row_count
      : typeof record.rowCount === "number"
        ? (record.rowCount as number)
        : rows.length;

  return {
    sql: typeof record.sql === "string" ? record.sql : "",
    columns,
    rows,
    rowCount,
  };
}
