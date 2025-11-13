"use client";

import * as React from "react";
import { Tldraw, toRichText, TLTextShape, TLShapeId, Editor } from "tldraw";
import "tldraw/tldraw.css";

/**
 * Board component that provides a collaborative whiteboard with AI integration.
 * Users can draw or write math problems and get AI-powered solutions.
 */
export default function Board() {
  // Reference to the Tldraw editor instance
  const editorRef = React.useRef<Editor | null>(null);
  // Loading state for the AI request
  const [loading, setLoading] = React.useState(false);
  // Session id (new each page load)
  const sessionIdRef = React.useRef<string>("");
  React.useEffect(() => {
    if (!sessionIdRef.current) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionIdRef.current = id;
    }
  }, []);

  // AI panel state: list of responses shown as notifications (AI-only display)
  type AIItem = { id: string; text: string; ts: number; question?: string };
  const [aiItems, setAiItems] = React.useState<AIItem[]>([]);
  type HistoryItem = { question: string; response: string; ts: number };
  type SessionMeta = { id: string; title: string; createdAt: number; updatedAt: number; count: number };
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [historyMode, setHistoryMode] = React.useState<"list" | "session">("list");
  const [sessions, setSessions] = React.useState<SessionMeta[] | null>(null);
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null);
  const [archive, setArchive] = React.useState<HistoryItem[] | null>(null);
  const [sessionTitle, setSessionTitle] = React.useState<string>("");
  const historyScrollRef = React.useRef<HTMLDivElement | null>(null);

  function addAIItem(text: string, question?: string) {
    const item: AIItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      question,
      ts: Date.now(),
    };
    setAiItems((prev) => [item, ...prev]);
  }

  function removeAIItem(id: string) {
    setAiItems((prev) => prev.filter((x) => x.id !== id));
  }

  async function openHistory() {
    setSessions(null);
    setArchive(null);
    setHistoryMode("list");
    setSelectedSessionId(null);
    try {
      const res = await fetch("/api/history", { method: "GET" });
      const j = await res.json();
      const list = Array.isArray(j?.sessions) ? (j.sessions as SessionMeta[]) : [];
      setSessions(list);
    } catch (e) {
      console.error("[History] Failed to load sessions:", e);
      setSessions([]);
    } finally {
      setHistoryOpen(true);
    }
  }

  async function openSession(id: string) {
    setSelectedSessionId(id);
    setArchive(null);
    setHistoryMode("session");
    try {
      const res = await fetch(`/api/history?sessionId=${encodeURIComponent(id)}`);
      const j = await res.json();
      const items = Array.isArray(j?.items) ? (j.items as HistoryItem[]) : [];
      // Oldest -> newest
      items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setArchive(items);
      setSessionTitle((j?.title ?? "").toString());
    } catch (e) {
      console.error("[History] Failed to load session:", e);
      setArchive([]);
    }
  }

  // Auto-scroll to bottom when viewing a session
  React.useEffect(() => {
    if (historyMode === "session" && historyScrollRef.current && archive) {
      const el = historyScrollRef.current;
      // defer to next frame to allow layout
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [historyMode, archive]);

  /**
   * Callback when the Tldraw editor mounts
   * @param editor - The Tldraw editor instance
   */
  const onMount = React.useCallback((editor: Editor) => {
    editorRef.current = editor;
    try {
      // @ts-ignore - Update editor state to allow editing
      editor.updateInstanceState({ isReadonly: false });
    } catch {}
    console.log("[Board] Editor mounted:", editor);
  }, []);

  /**
   * Calculates the bounding box that contains all specified shapes
   */
  function getUnionBounds(editor: any, ids: TLShapeId[]) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const id of ids) {
      const b =
        editor.getShapePageBounds?.(id) ?? editor.getPageBounds?.(id) ?? null;
      if (!b) continue;

      const x = b.x ?? b.minX ?? 0;
      const y = b.y ?? b.minY ?? 0;
      const w =
        b.w ??
        b.width ??
        (b.maxX != null && b.minX != null ? b.maxX - b.minX : 0);
      const h =
        b.h ??
        b.height ??
        (b.maxY != null && b.minY != null ? b.maxY - b.minY : 0);

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + w > maxX) maxX = x + w;
      if (y + h > maxY) maxY = y + h;
    }

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY))
      return null;

    return {
      minX,
      minY,
      maxX,
      maxY,
      w: maxX - minX,
      h: maxY - minY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    };
  }

  /**
   * Captures the current board content, sends it to the AI, and displays the response
   */
  const askAI = React.useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) {
      alert("Editor not ready yet.");
      return;
    }

    try {
      setLoading(true);

      // Get selected shapes or all shapes if none selected
      const selection = Array.from(editor.getSelectedShapeIds?.() ?? []);
      const all = Array.from(editor.getCurrentPageShapeIds?.() ?? []);
      const shapeIds: TLShapeId[] = selection.length > 0 ? selection : all;

      if (shapeIds.length === 0) {
        alert("Draw or select the problem first.");
        return;
      }

      // Export the selected area as an image
      const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
      const { blob } = await editor.toImage(shapeIds, {
        format: "png",
        background: true,
        padding: 24,
        scale,
      });

      if (!blob) {
        alert("Failed to export image.");
        return;
      }

      // Prepare the image for sending to the API
      const fd = new FormData();
      fd.append("image", new File([blob], "board.png", { type: "image/png" }));
      if (sessionIdRef.current) fd.append("sessionId", sessionIdRef.current);

      // Send the image to the solve API
      const res = await fetch("/api/solve", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Solve failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg += ` — ${j.error}`;
        } catch {}
        throw new Error(msg);
      }

      // Process the API response
      const raw = await res.json();
      console.log("[/api/solve] payload:", raw);

      // Format the response text
      let finalText = (raw?.message ?? "").toString().trim();
      if (!finalText) {
        const answerPlain = (raw?.answerPlain ?? "").trim();
        const answerLatex = (raw?.answerLatex ?? "").trim();
        const explanation = (raw?.explanation ?? "").trim();
        finalText = answerPlain || answerLatex || "Could not read.";
        if (explanation) finalText = `${finalText}\n\n${explanation}`;
      }

      // Add to AI panel (notifications list)
      const questionText = (raw?.questionText ?? "").toString().trim();
      addAIItem(finalText, questionText);

      // Calculate position for the response text (keep existing functionality)
      const b = getUnionBounds(editor, shapeIds);
      let x: number, y: number;
      if (b) {
        // Position below the selected area
        x = b.minX;
        y = b.maxY + 40;
      } else {
        // Fallback to viewport center if bounds can't be calculated
        const p = editor.screenToPage(editor.getViewportScreenCenter());
        x = p.x;
        y = p.y;
      }

      // Create a text shape with the AI response on the canvas
      editor.createShape<TLTextShape>({
        type: "text",
        x,
        y,
        props: {
          richText: toRichText(finalText),
          autoSize: false,
          w: 400,
        },
      });
    } catch (err) {
      console.error("[AskAI] Error:", err);
      alert(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {/* Canvas area (left 3/4) */}
      <div className="relative flex-1 min-w-0">
        <Tldraw onMount={onMount} persistenceKey={undefined} autoFocus />
      </div>

      {/* AI Panel (right 1/4) */}
      <aside
        className="relative w-1/4 min-w-[320px] max-w-[520px] h-full border-l border-neutral-200 bg-white flex flex-col"
        style={{ pointerEvents: "auto" }}
        aria-label="AI Panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
          <div className="text-sm font-semibold text-neutral-700 select-none">
            AI
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openHistory}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 bg-white text-neutral-800 shadow-sm text-sm hover:bg-neutral-100"
              title="Open history"
            >
              History
            </button>
            <button
              onClick={askAI}
              disabled={loading}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 bg-white text-neutral-800 shadow-sm text-sm hover:bg-neutral-100 disabled:opacity-50"
              title="Export board and ask AI"
            >
              {loading ? "Thinking…" : "Ask AI"}
            </button>
            {aiItems.length > 0 && (
              <button
                onClick={() => setAiItems([])}
                className="text-xs text-neutral-500 hover:text-neutral-700"
                title="Clear all"
              >
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Content list (notifications). Read-only: no inputs and selection disabled */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2 select-none">
          {aiItems.length === 0 ? (
            <div className="text-xs text-neutral-500 mt-2">
              Responses will appear here.
            </div>
          ) : (
            aiItems.map((item) => (
              <div
                key={item.id}
                className="relative rounded-lg border border-neutral-200 bg-white shadow-sm p-3 pr-8"
                role="status"
                aria-live="polite"
              >
                <div className="text-xs text-neutral-400 mb-1">
                  {new Date(item.ts).toLocaleTimeString()}
                </div>
                <div className="whitespace-pre-wrap text-sm text-neutral-900">
                  {item.text}
                </div>
                <button
                  onClick={() => removeAIItem(item.id)}
                  className="absolute top-2 right-2 text-neutral-400 hover:text-neutral-700"
                  title="Dismiss"
                  aria-label="Dismiss"
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* Archive overlay */}
        {historyOpen && (
          <div className="absolute inset-0 bg-white/85 backdrop-blur-sm flex flex-col">
            {/* History header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-white/90">
              <div className="text-sm font-semibold text-neutral-700">History</div>
              <div className="flex items-center gap-2">
                {historyMode === "session" && (
                  <button
                    onClick={() => setHistoryMode("list")}
                    className="rounded-lg border border-neutral-300 px-3 py-1.5 bg-white text-neutral-800 shadow-sm text-sm hover:bg-neutral-100"
                    title="Back to sessions"
                  >
                    Sessions
                  </button>
                )}
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="rounded-lg border border-neutral-300 px-3 py-1.5 bg-white text-neutral-800 shadow-sm text-sm hover:bg-neutral-100"
                  title="Close history"
                >
                  Close
                </button>
              </div>
            </div>
            {/* History content */}
            {historyMode === "list" ? (
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {sessions === null ? (
                  <div className="text-xs text-neutral-500">Loading…</div>
                ) : sessions.length === 0 ? (
                  <div className="text-xs text-neutral-500">No sessions yet.</div>
                ) : (
                  sessions.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => openSession(s.id)}
                      className="w-full text-left rounded-lg border border-neutral-200 bg-white hover:bg-neutral-50 px-3 py-2 shadow-sm"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-sm font-medium text-neutral-800 truncate">{s.title || s.id}</div>
                        <div className="text-[11px] text-neutral-500">{new Date(s.updatedAt).toLocaleString()}</div>
                      </div>
                      <div className="text-xs text-neutral-500">{s.count} message{s.count === 1 ? "" : "s"}</div>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <div ref={historyScrollRef} className="flex-1 overflow-y-auto p-3 space-y-4">
                {sessionTitle && (
                  <div className="text-xs text-neutral-500 px-1">Session: {sessionTitle}</div>
                )}
                {archive === null ? (
                  <div className="text-xs text-neutral-500">Loading…</div>
                ) : archive.length === 0 ? (
                  <div className="text-xs text-neutral-500">No messages yet.</div>
                ) : (
                  archive.map((it, idx) => (
                    <div key={it.ts + '-' + idx} className="space-y-2">
                      <div className="text-[11px] text-neutral-400">
                        {new Date(it.ts).toLocaleString()}
                      </div>
                      {/* Question bubble (right) */}
                      {it.question && (
                        <div className="flex justify-end">
                          <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900 whitespace-pre-wrap">
                            {it.question}
                          </div>
                        </div>
                      )}
                      {/* Response bubble (left) */}
                      <div className="flex justify-start">
                        <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm text-neutral-900 whitespace-pre-wrap">
                          {it.response}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}