"use client";

import * as React from "react";
import { Tldraw, toRichText, TLTextShape, TLShapeId, Editor } from "tldraw";
import "tldraw/tldraw.css";

/**
 * Board component that provides a collaborative whiteboard with AI integration.
 * Users can draw or write math problems and get AI-powered solutions.
 */
export default function Board({ boardId }: { boardId: string }) {
  // Reference to the Tldraw editor instance
  const editorRef = React.useRef<Editor | null>(null);
  // Loading state for the AI request
  const [loading, setLoading] = React.useState(false);
  // Board id is provided by the page route

  // AI panel state: list of responses shown as notifications (AI-only display)
  type AIItem = { id: string; text: string; ts: number; question?: string };
  const [aiItems, setAiItems] = React.useState<AIItem[]>([]);
  type HistoryItem = { question: string; response: string; ts: number };
  type SessionMeta = {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    count: number;
  };
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [archive, setArchive] = React.useState<HistoryItem[] | null>(null);
  const historyScrollRef = React.useRef<HTMLDivElement | null>(null);
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const recognitionRef = React.useRef<any | null>(null);
  const interimRef = React.useRef<string>("");
  const keepListeningRef = React.useRef<boolean>(false);
  const [isRecording, setIsRecording] = React.useState(false);

  // Whether to add AI responses to the canvas as a text shape
  const [addToCanvas, setAddToCanvas] = React.useState<boolean>(() => {
    try {
      const v = localStorage.getItem("addToCanvas");
      return v ? v === "true" : true;
    } catch {
      return true;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem("addToCanvas", String(addToCanvas));
    } catch {}
  }, [addToCanvas]);

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
    setArchive(null);
    try {
      const res = await fetch(`/api/boards/${encodeURIComponent(boardId)}`, {
        method: "GET",
      });
      const j = await res.json();
      const items = Array.isArray(j?.items) ? (j.items as HistoryItem[]) : [];
      items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setArchive(items);
    } catch (e) {
      console.error("[History] Failed to load board:", e);
      setArchive([]);
    } finally {
      setHistoryOpen(true);
    }
  }

  // Auto-scroll to bottom when viewing a session
  React.useEffect(() => {
    if (historyScrollRef.current && archive) {
      const el = historyScrollRef.current;
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [archive]);

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
  }, []); // Fixed: removed addToCanvas from dependencies

  function addResponseToCanvas(text: string) {
    const editor = editorRef.current;
    if (!editor) return;
    const p = editor.screenToPage(editor.getViewportScreenCenter());
    editor.createShape<TLTextShape>({
      type: "text",
      x: p.x,
      y: p.y,
      props: {
        richText: toRichText(text),
        autoSize: false,
        w: 400,
      },
    });
  }

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

    if (
      !isFinite(minX) ||
      !isFinite(minY) ||
      !isFinite(maxX) ||
      !isFinite(maxY)
    )
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
  const askAI = React.useCallback(
    async (questionFromVoice?: string) => {
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
        fd.append(
          "image",
          new File([blob], "board.png", { type: "image/png" })
        );
        if (boardId) fd.append("boardId", boardId);
        if (questionFromVoice && questionFromVoice.trim()) {
          fd.append("question", questionFromVoice.trim());
        }

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

        // Read the current value of addToCanvas from localStorage to ensure we have the latest value
        console.log("here");
        let shouldAddToCanvas = addToCanvas;
        try {
          const stored = localStorage.getItem("addToCanvas");
          shouldAddToCanvas = stored ? stored === "true" : true;
        } catch {}
        console.log("Right before check for addToCanvas: ", shouldAddToCanvas);
        // Optionally create a text shape with the AI response on the canvas
        if (shouldAddToCanvas) {
          console.log("[Board] Adding AI response to canvas:", finalText);
          // Calculate position for the response text
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
        }
      } catch (err) {
        console.error("[AskAI] Error:", err);
        alert(String(err instanceof Error ? err.message : err));
      } finally {
        setLoading(false);
      }
    },
    [addToCanvas]
  ); // Fixed: added addToCanvas to dependencies

  // Voice input: start/stop recognition
  function startVoiceInput() {
    try {
      const SR: any =
        (window as any).SpeechRecognition ||
        (window as any).webkitSpeechRecognition;
      if (!SR) {
        alert("Speech recognition is not supported in this browser.");
        return;
      }
      const rec = new SR();
      recognitionRef.current = rec;
      interimRef.current = "";
      keepListeningRef.current = true;
      let finalText = "";
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalText += res[0].transcript + " ";
          } else {
            interim += res[0].transcript;
          }
        }
        interimRef.current = interim;
      };
      rec.onerror = (e: any) => {
        console.error("[Voice] error:", e);
      };
      rec.onend = () => {
        const spoken = (finalText || interimRef.current).trim();
        if (spoken) {
          // Add the spoken question to the canvas like a note
          addResponseToCanvas(spoken);
          // Ask AI with the spoken question
          askAI(spoken);
        }
        if (keepListeningRef.current) {
          interimRef.current = "";
          finalText = "";
          try {
            rec.start();
            setIsRecording(true);
          } catch (err) {
            console.error("[Voice] restart failed:", err);
            setIsRecording(false);
          }
        } else {
          setIsRecording(false);
        }
      };
      setIsRecording(true);
      rec.start();
    } catch (e) {
      console.error("[Voice] start failed:", e);
      setIsRecording(false);
    }
  }

  function stopVoiceInput() {
    try {
      keepListeningRef.current = false;
      const rec = recognitionRef.current;
      if (rec && typeof rec.stop === "function") {
        rec.stop();
      }
    } catch (e) {
      console.error("[Voice] stop failed:", e);
    } finally {
      setIsRecording(false);
    }
  }

  React.useEffect(() => {
    return () => {
      try {
        keepListeningRef.current = false;
        const rec = recognitionRef.current;
        if (rec && typeof rec.stop === "function") rec.stop();
      } catch {}
    };
  }, []);

  return (
    <div className="flex h-full w-full min-h-0 overflow-hidden bg-white">
      {/* Canvas area (left 3/4) */}
      <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="absolute inset-0 bg-white">
          <Tldraw onMount={onMount} persistenceKey={undefined} autoFocus />
        </div>
      </div>

      {/* AI Panel (right 1/4) */}
      <aside
        className="relative w-1/4 min-w-[320px] max-w-[520px] h-full min-h-0 border-l border-neutral-200 bg-white flex flex-col"
        style={{ pointerEvents: "auto" }}
        aria-label="AI Panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-neutral-50">
          <div className="text-sm font-semibold text-neutral-700 select-none">
            AI Panel
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => askAI()}
              disabled={loading}
              className="rounded-md px-4 py-2.5 bg-blue-600 text-yellow-400 font-semibold shadow-sm text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              title="Export board and ask AI"
            >
              {loading ? "Thinking…" : "Ask AI"}
            </button>
            <div className="relative">
              <button
                onClick={() => setSettingsOpen((v) => !v)}
                className="p-1.5 text-2xl text-neutral-500 hover:text-neutral-800"
                title="Settings"
                aria-haspopup="menu"
                aria-expanded={settingsOpen}
              >
                ⚙️
              </button>
              {settingsOpen && (
                <div
                  role="menu"
                  aria-label="AI Panel settings"
                  className="absolute right-0 mt-2 w-56 rounded-lg border border-neutral-200 bg-white shadow-lg p-2 z-10"
                >
                  <label
                    className="flex items-center gap-2 px-2 py-2 text-sm text-neutral-800 cursor-pointer"
                    title="Automatically place AI responses onto the canvas"
                  >
                    <input
                      type="checkbox"
                      className="accent-blue-600"
                      checked={addToCanvas}
                      onChange={(e) => {
                        setAddToCanvas(e.target.checked);
                      }}
                    />
                    <span>Always add to Canvas</span>
                  </label>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSettingsOpen(false);
                      openHistory();
                    }}
                    className="w-full text-left px-2 py-2 rounded-md text-sm text-neutral-800 hover:bg-neutral-100"
                    title="Open history"
                  >
                    History
                  </button>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setSettingsOpen(false);
                      setAiItems([]);
                    }}
                    disabled={aiItems.length === 0}
                    className="w-full text-left px-2 py-2 rounded-md text-sm text-neutral-800 hover:bg-neutral-100 disabled:opacity-50"
                    title="Clear all responses"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </div>
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
                className="relative rounded-lg border border-neutral-200 bg-white shadow-sm p-3 pr-12"
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
                  onClick={() => addResponseToCanvas(item.text)}
                  className="absolute top-2 right-8 text-neutral-400 hover:text-neutral-700"
                  title="Add to canvas"
                  aria-label="Add to canvas"
                >
                  +
                </button>
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

        {/* Footer: Voice input */}
        <div className="border-t border-neutral-200 px-3 py-2 bg-white flex items-center justify-between">
          <div className="text-[11px] text-neutral-500 select-none">
            Voice input
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={isRecording ? stopVoiceInput : startVoiceInput}
              className={`rounded-full px-3 py-1.5 text-sm shadow-sm transition-colors ${
                isRecording
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
              title={isRecording ? "Stop voice input" : "Start voice input"}
              aria-pressed={isRecording}
              aria-label={
                isRecording ? "Stop voice input" : "Start voice input"
              }
            >
              {isRecording ? "⏹️ Stop" : "🎤 Speak"}
            </button>
          </div>
        </div>

        {/* Archive overlay */}
        {historyOpen && (
          <div className="absolute inset-0 bg-white flex flex-col">
            {/* History header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-white">
              <div className="text-sm font-semibold text-neutral-700">
                History
              </div>
              <div>
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
            <div
              ref={historyScrollRef}
              className="flex-1 overflow-y-auto p-3 space-y-4"
            >
              {archive === null ? (
                <div className="text-xs text-neutral-500">Loading…</div>
              ) : archive.length === 0 ? (
                <div className="text-xs text-neutral-500">No messages yet.</div>
              ) : (
                archive.map((it, idx) => (
                  <div key={it.ts + "-" + idx} className="space-y-2">
                    <div className="text-[11px] text-neutral-400">
                      {new Date(it.ts).toLocaleString()}
                    </div>
                    {it.question && (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-blue-50 border border-blue-200 px-3 py-2 text-sm text-blue-900 whitespace-pre-wrap">
                          {it.question}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-neutral-50 border border-neutral-200 px-3 py-2 text-sm text-neutral-900 whitespace-pre-wrap">
                        {it.response}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}
