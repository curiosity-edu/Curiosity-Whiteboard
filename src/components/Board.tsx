"use client";

import * as React from "react";
import {
  Tldraw,
  TLUiComponents,
  useEditor,
  toRichText,
  TLTextShape,
} from "tldraw";
import "tldraw/tldraw.css";

function AskAiButton() {
  const editor = useEditor();
  const [loading, setLoading] = React.useState(false);

  const askAI = async () => {
    try {
      setLoading(true);

      // 1) Choose what to export: selection if available, else all shapes on page
      const selection = editor.getSelectedShapeIds();
      const shapeIds =
        selection.length > 0 ? [...selection] : [...editor.getCurrentPageShapeIds()];

      if (shapeIds.length === 0) {
        alert("Draw a math problem first.");
        return;
      }

      // 2) Export to an image Blob (tldraw v2)
      //    Tip: jpeg keeps request payloads small
      const scale = Math.max(2, Math.ceil(window.devicePixelRatio || 1));
      const { blob } = await editor.toImage(shapeIds, {
        format: "png",
        background: true,
        padding: 24,
        scale, // 2–3 is a sweet spot
      });

      // 3) Send to backend
      const fd = new FormData();
      fd.append("image", new File([blob], "board.jpg", { type: "image/jpeg" }));

      const res = await fetch("/api/solve", { method: "POST", body: fd });

      // ⬇️ Read server error JSON so you see WHY it failed
      if (!res.ok) {
        let msg = `Solve failed (${res.status})`;
        try {
          const j = await res.json();
          if (j?.error) msg += ` — ${j.error}`;
        } catch {
          // ignore JSON parse error
        }
        throw new Error(msg);
      }

      const data = (await res.json()) as { answer?: string };
      const text = (data?.answer ?? "Could not read.").toString();

      // 4) Place the answer at the viewport center (page coordinates)
      const screenCenter = editor.getViewportScreenCenter();
      const { x, y } = editor.screenToPage(screenCenter);

      editor.createShape<TLTextShape>({
        type: "text",
        x,
        y,
        props: { richText: toRichText(text) },
      });
    } catch (err) {
      console.error(err);
      alert(String(err instanceof Error ? err.message : err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{ position: "absolute", right: 16, top: 8, zIndex: 20, pointerEvents: "all" }}
    >
      <button
        onClick={askAI}
        disabled={loading}
        className="rounded-xl border px-4 py-2 bg-white shadow"
        title="Export board and ask AI"
      >
        {loading ? "Thinking…" : "Ask AI"}
      </button>
    </div>
  );
}

export default function Board() {
  // Render the button inside tldraw's React context
  const components: TLUiComponents = { SharePanel: AskAiButton };

  return (
    <main className="h-screen w-screen overflow-hidden">
      <Tldraw components={components} />
    </main>
  );
}
