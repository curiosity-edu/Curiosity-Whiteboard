"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Tldraw,
  toRichText,
  TLTextShape,
  TLShapeId,
  Editor,
  getSnapshot,
  loadSnapshot,
} from "tldraw";
import "tldraw/tldraw.css";
import MyBoardsSidebar from "@/components/MyBoardsSidebar";
import { UserAuth } from "@/context/AuthContext";
import { database } from "@/lib/firebase";
import { doc as fsDoc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Board component that provides a collaborative whiteboard with AI integration.
 * Users can draw or write math problems and get AI-powered solutions.
 */
export default function Board({ boardId }: { boardId: string }) {
  const router = useRouter();
  // Reference to the Tldraw editor instance
  const editorRef = React.useRef<Editor | null>(null);
  const [editorMountVersion, setEditorMountVersion] = React.useState(0);
  const suppressCanvasTextRef = React.useRef(false);
  // Loading state for the AI request
  const [loading, setLoading] = React.useState(false);
  // Board id is provided by the page route

  // AI panel state: list of responses shown as notifications (AI-only display)
  type AIItem = {
    id: string;
    text: string;
    ts: number;
    question?: string;
    modeCategory?: string;
  };
  const [aiItems, setAiItems] = React.useState<AIItem[]>([]);
  const aiScrollRef = React.useRef<HTMLDivElement | null>(null);
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
  const recognitionRef = React.useRef<any | null>(null);
  const interimRef = React.useRef<string>("");
  const finalVoiceRef = React.useRef<string>("");
  const submitVoiceOnStopRef = React.useRef<boolean>(false);
  const keepListeningRef = React.useRef<boolean>(false);
  const [isRecording, setIsRecording] = React.useState(false);
  // Autosave helpers
  const saveTimerRef = React.useRef<NodeJS.Timeout | null>(null);
  const isLoadingDocRef = React.useRef<boolean>(false);
  const [editorReady, setEditorReady] = React.useState(false);
  const [boardItems, setBoardItems] = React.useState<HistoryItem[]>([]);

  const ctx = (UserAuth() as any) || [];
  const user = ctx[0];

  const aiItemsStorageKey = React.useMemo(() => {
    const uid = user?.uid ? String(user.uid) : "anon";
    const bid = boardId || "default";
    return `curiosity:aiItems:${uid}:${bid}`;
  }, [user?.uid, boardId]);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(aiItemsStorageKey);
      if (!raw) {
        setAiItems([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setAiItems([]);
        return;
      }
      const cleaned = parsed
        .filter((x: any) => x && typeof x === "object")
        .map((x: any) => ({
          id: String(x.id || ""),
          text: String(x.text || ""),
          ts: Number(x.ts || 0),
          question: x.question ? String(x.question) : undefined,
          modeCategory: x.modeCategory ? String(x.modeCategory) : undefined,
        }))
        .filter((x: any) => x.id && x.text);
      setAiItems(cleaned);
    } catch {
      setAiItems([]);
    }
  }, [aiItemsStorageKey]);

  React.useEffect(() => {
    try {
      localStorage.setItem(aiItemsStorageKey, JSON.stringify(aiItems));
    } catch {}
  }, [aiItemsStorageKey, aiItems]);

  // Prevent signed-in users from staying on a local/unknown board route.
  // If the boardId doesn't exist in Firestore, redirect to '/' so it can route
  // to the most recently updated board or auto-create a default one.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || !boardId) return;
      try {
        const ref = fsDoc(database, "users", user.uid, "boards", boardId);
        const snap = await getDoc(ref);
        if (!cancelled && !snap.exists()) {
          router.replace("/");
        }
      } catch {
        if (!cancelled) router.replace("/");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, boardId, router]);

  // When a user signs out, reset transient UI state so the anonymous session
  // starts blank (without affecting the signed-in Firestore persisted data).
  React.useEffect(() => {
    if (user) return;
    setAiItems([]);
    setHistoryOpen(false);
    setArchive(null);
    setBoardItems([]);
    stopVoiceInput();
  }, [user]);

  // Whether to add AI responses to the canvas as a text shape
  const [addToCanvas, setAddToCanvas] = React.useState<boolean>(() => {
    try {
      const v = localStorage.getItem("addToCanvas");
      return v ? v === "true" : false;
    } catch {
      return false;
    }
  });
  React.useEffect(() => {
    try {
      localStorage.setItem("addToCanvas", String(addToCanvas));
    } catch {}
  }, [addToCanvas]);

  function addAIItem(text: string, question?: string, modeCategory?: string) {
    const item: AIItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      question,
      modeCategory,
      ts: Date.now(),
    };
    setAiItems((prev) => [item, ...prev]);
  }

  function removeAIItem(id: string) {
    setAiItems((prev) => prev.filter((x) => x.id !== id));
  }

  React.useEffect(() => {
    const el = aiScrollRef.current;
    if (!el) return;
    // Newest messages are inserted at the top; keep the viewport pinned to the top on new items.
    el.scrollTop = 0;
  }, [aiItems.length]);

  function preprocessMath(text: string) {
    let s = (text || "").toString();

    const DEBUG_MATH = (() => {
      try {
        return localStorage.getItem("curiosity:debugMath") === "1";
      } catch {
        return false;
      }
    })();

    function normalizeDollarDelimiters(input: string) {
      let out = (input || "").toString();

      // Convert TeX inline/display delimiters into $/$$ so remark-math can parse.
      out = out.replace(/\\\(([^]*?)\\\)/g, (_m, inner) => {
        return `$${String(inner).trim()}$`;
      });
      out = out.replace(/\\\[([^]*?)\\\]/g, (_m, inner) => {
        return `\n\n$$${String(inner).trim()}$$\n\n`;
      });

      // Collapse any accidental $$$ or longer runs into $$.
      out = out.replace(/\${3,}/g, "$$");
      // Fix cases like "$$$a+b$^2...$$" where a stray $ appears right after $$.
      out = out.replace(/\$\$\s*\$/g, "$$");
      out = out.replace(/\$\s*\$\$/g, "$$");

      // Fix split inline math like "$a+b$^2" or "$a+b$²" by merging into a single math span.
      out = out.replace(/\$([^$\n]+?)\$\s*\^\s*([0-9]+)/g, (_m, body, exp) => {
        return `$${String(body).trim()}^${String(exp).trim()}$`;
      });
      out = out.replace(/\$([^$\n]+?)\$\s*([²³])/g, (_m, body, sup) => {
        const e = sup === "²" ? "2" : sup === "³" ? "3" : "";
        if (!e) return _m;
        return `$${String(body).trim()}^${e}$`;
      });

      function looksLikeProse(t: string) {
        // If it has multi-letter words and sentence punctuation, it's probably prose.
        // IMPORTANT: ignore LaTeX command names like "\\mathbf" or "\\nabla" when deciding.
        const stripped = (t || "")
          .replace(/\\[A-Za-z]+/g, " ")
          .replace(/[{}]/g, " ");
        const hasWord = /\b[a-zA-Z]{3,}\b/.test(stripped);
        const hasSentence = /[.!?]/.test(t);
        return hasWord && hasSentence;
      }

      // Repair $$...$$ blocks:
      // - If they contain nested $, strip nested $.
      // - If they contain prose, extract the leading math segment and keep prose outside.
      out = out.replace(/\$\$([\s\S]*?)\$\$/g, (m, innerRaw, idx, full) => {
        const inner = String(innerRaw);
        const noNested = inner.replace(/\$/g, "").trim();

        const sFull = String(full);
        const before =
          typeof idx === "number" && idx > 0 ? sFull.slice(idx - 1, idx) : "";
        const after =
          typeof idx === "number" && idx + m.length < sFull.length
            ? sFull.slice(idx + m.length, idx + m.length + 1)
            : "";
        const isInlineContext =
          (before && before !== "\n") || (after && after !== "\n");

        const hasStrongMathSignal =
          /\\(frac|sqrt|sum|int|oint|iint|iiint|nabla|partial|cdot|times|mathbf|left|right)\b/.test(
            inner,
          ) || /[=^_]/.test(noNested);

        // If $$...$$ is used inline within a sentence, treat it as inline math.
        // Otherwise remark-math parsing is brittle and we risk mangling it.
        if (
          isInlineContext &&
          !noNested.includes("\n") &&
          noNested.length < 240
        ) {
          return `$${noNested}$`;
        }

        // If the model incorrectly wrapped a full sentence in $$...$$, unwrap it.
        // But never unwrap blocks that have strong math signals (e.g. Stokes).
        if (!hasStrongMathSignal && looksLikeProse(noNested)) {
          // Try to extract a leading equation-like chunk, stopping before common prose linkers.
          // Example: "a+b^2 = a^2 + b^2 is that it doesn't..." -> "$a+b^2 = a^2 + b^2$ is that it doesn't..."
          const linkerMatch = noNested.match(
            /\b(is|are|was|were|that|which|because|since)\b/i,
          );
          const cutIdx = linkerMatch?.index;
          if (typeof cutIdx === "number" && cutIdx > 0) {
            const left = noNested.slice(0, cutIdx).trim();
            const right = noNested.slice(cutIdx).trim();
            if (left && /[=^_]/.test(left)) {
              return `$${left}$ ${right}`;
            }
          }
          return noNested;
        }

        // Otherwise, keep as display math (ensure on its own lines).
        return `\n\n$$\n${noNested}\n$$\n\n`;
      });

      // If $$...$$ occurs inline inside a sentence, treat it as inline math $...$
      // so remark-math can reliably parse it.
      out = out.replace(/\$\$([^\n]+?)\$\$/g, (m, inner, idx, full) => {
        const before = idx > 0 ? String(full).slice(idx - 1, idx) : "";
        const after =
          idx + m.length < String(full).length
            ? String(full).slice(idx + m.length, idx + m.length + 1)
            : "";
        const isInline =
          (before && before !== "\n") || (after && after !== "\n");
        if (!isInline) return m;
        return `$${String(inner).trim()}$`;
      });
      return out;
    }

    s = normalizeDollarDelimiters(s);

    function mapOutsideMathAndCode(
      input: string,
      fn: (chunk: string) => string,
    ) {
      return input
        .split(/(```[\s\S]*?```|`[^`]*`|\$\$[\s\S]*?\$\$|\$[^$\n]*\$)/g)
        .map((chunk) => {
          if (!chunk) return chunk;
          if (chunk.startsWith("```") || chunk.startsWith("`")) return chunk;
          if (chunk.startsWith("$$") && chunk.endsWith("$$")) return chunk;
          if (chunk.startsWith("$") && chunk.endsWith("$")) return chunk;
          return fn(chunk);
        })
        .join("");
    }

    function wrapLatexRuns(input: string) {
      return mapOutsideMathAndCode(input, (chunk) => {
        const normalized = chunk
          .replace(/\\mathbf\b/g, "\\mathbf")
          .replace(/\\d\b/g, "d");

        const cmd =
          "\\\\(?:int|oint|iint|iiint|nabla|partial|mathbf|cdot|times|frac|sqrt|left|right)\\b";
        const hasMathSignal = (t: string) =>
          /=/.test(t) || /\\\\(cdot|times)\\b/.test(t) || /[_^]/.test(t);

        let out = normalized;

        out = out.replace(
          new RegExp(
            `(${cmd}[\\s\\S]*?)(?=(\\n\\s*\\n)|(\\.\\s+(?=[A-Z][a-z]))|$)`,
            "g",
          ),
          (_m, body) => {
            const t = String(body).trim();
            if (!t) return body;
            if (!hasMathSignal(t)) return body;
            if (t.length > 1600) return body;
            return `\n\n$$\n${t}\n$$\n\n`;
          },
        );

        out = out.replace(
          /(\([^\)\n]{1,80}\)\s*(?:\^\s*\d+|[²³])\s*=\s*[^\n\.]{1,180})/g,
          (m) => {
            const t = String(m).trim();
            if (!t) return m;
            return `$${t}$`;
          },
        );

        out = out.replace(
          /\(\s*([^\)]+?)\s*\)\s*(?:\^\s*([0-9]+)|([²³]))/g,
          (m, inner, expCaret, expSup) => {
            if (String(m).includes("$")) return m;
            const v = String(inner);
            const e =
              typeof expCaret === "string" && expCaret
                ? expCaret
                : expSup === "²"
                  ? "2"
                  : expSup === "³"
                    ? "3"
                    : "";
            if (!e) return m;
            if (!/[+\-*/=^_]/.test(v)) return m;
            return `$(${v.trim()})^${e}$`;
          },
        );

        return out;
      });
    }

    // The model already produces well-formed math most of the time.
    // At this stage, we only:
    // 1) normalize delimiters (\( \)/\[ \]/malformed $$)
    // 2) wrap raw TeX command runs that leaked outside math
    // Further heuristic rewrites below have proven destructive (they can break correct $$ blocks).
    s = wrapLatexRuns(s);
    s = normalizeDollarDelimiters(s);

    if (DEBUG_MATH) {
      try {
        console.log("[math][debug] preprocessMath output:", s);
      } catch {}
    }

    return s;

    function looksMathy(inner: string) {
      const t = (inner || "").trim();
      if (!t) return false;
      // Must contain a math operator / latex command.
      const hasMathSignal =
        /[=^_]/.test(t) ||
        /[+\-*/]/.test(t) ||
        /\\(frac|sqrt|sum|int|oint|iint|iiint|nabla|partial|cdot|times|mathbf|vec|pi|theta|lambda|Delta|Gamma)\b/.test(
          t,
        );
      if (!hasMathSignal) return false;
      // Avoid wrapping normal sentences like "(this is a note)".
      const looksLikeSentence = /[a-zA-Z]{3,}.*\s+[a-zA-Z]{3,}/.test(t);
      if (looksLikeSentence) return false;
      // Only allow a conservative set of characters.
      if (!/^[0-9A-Za-z\s+\-*/^_=().,\\]+$/.test(t)) return false;
      return true;
    }

    // If the model outputs latex-like tokens without $...$, wrap common patterns so KaTeX can render.
    // Example: sum_k=1^100 k  -> $\sum_{k=1}^{100} k$
    s = s.replace(
      /(^|\s)sum_([A-Za-z])\s*=\s*([0-9]+)\s*\^\s*([0-9]+)\s*([A-Za-z])?(?=\s|$)/g,
      (_m, pre, idx, a, b, tail) =>
        `${pre}$\\sum_{${idx}=${a}}^{${b}}${tail ? " " + tail : ""}$`,
    );

    // Wrap standalone LaTeX-looking lines into display math early, BEFORE we try
    // to wrap parenthesized sub-expressions. This avoids fragmenting equations like Stokes'.
    s = s
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.includes("$$") || t.includes("$") || t.startsWith("```"))
          return line;
        const startsWithMathCommand =
          /^\\(int|oint|iint|iiint|sum|prod|lim|nabla|partial|frac|sqrt)\b/.test(
            t,
          );
        const equationLike =
          /\S/.test(t) &&
          /=/.test(t) &&
          /\\(int|oint|iint|iiint|nabla|partial|cdot|times|mathbf)\b/.test(t);
        const looksLatex =
          /\\(frac|sqrt|sum|int|oint|iint|iiint|left|right|nabla|partial|cdot|times|mathbf)\b/.test(
            t,
          ) || /[_^]/.test(t);
        const looksLikeSentence = /[a-zA-Z].*\s+[a-zA-Z]/.test(t);
        if (startsWithMathCommand) return `\n\n$$${t}$$\n\n`;
        if (equationLike) return `\n\n$$${t}$$\n\n`;
        if (looksLatex && !looksLikeSentence) return `\n\n$$${t}$$\n\n`;
        return line;
      })
      .join("\n");

    // Convert common "math in brackets" patterns into display math.
    // Example: [(a+b)^2 = a^2 + 2ab + b^2.] -> $$ (a+b)^2 = a^2 + 2ab + b^2. $$
    function mapOutsideDisplayMathBlocks(
      input: string,
      fn: (chunk: string) => string,
    ) {
      return input
        .split(/(\$\$[\s\S]*?\$\$)/g)
        .map((chunk) => {
          if (chunk.startsWith("$$") && chunk.endsWith("$$")) return chunk;
          return fn(chunk);
        })
        .join("");
    }

    s = mapOutsideDisplayMathBlocks(s, (chunk) => {
      return chunk.replace(/\[\s*([^\]]+?)\s*\]/g, (m, inner) => {
        if (String(inner).includes("$")) return m;
        if (!looksMathy(inner)) return m;
        return `\n\n$$${String(inner).replace(/\$/g, "")}$$\n\n`;
      });
    });

    // Convert double-parenthesized math like ((a+b)^2 = a^2 + b^2) into display math.
    s = mapOutsideDisplayMathBlocks(s, (chunk) => {
      return chunk.replace(/\(\(\s*([^\)]{3,}?)\s*\)\)/g, (m, inner) => {
        if (String(inner).includes("$")) return m;
        if (!looksMathy(inner)) return m;
        return `\n\n$$${String(inner).replace(/\$/g, "")}$$\n\n`;
      });
    });

    // Wrap ( ... )^n as a single inline math chunk so we don't end up with "$a+b$^2".
    s = mapOutsideDisplayMathBlocks(s, (chunk) => {
      return chunk.replace(
        /\(\s*([^\)]+?)\s*\)\s*(?:\^\s*({[^}]+}|[0-9]+)|([²³]))/g,
        (_m, base, expCaret, expSup) => {
          const b = String(base).replace(/\$/g, "").trim();
          const eRaw =
            typeof expCaret === "string" && expCaret
              ? expCaret
              : expSup === "²"
                ? "2"
                : expSup === "³"
                  ? "3"
                  : "";
          const e = String(eRaw).replace(/\$/g, "").trim();
          if (!e) return _m;
          if (!looksMathy(`${b}^${e}`)) {
            return expSup ? `(${base})^${e}` : `(${base})^${expCaret}`;
          }
          return `$(${b})^${e}$`;
        },
      );
    });

    // Convert single parenthesized math terms like (2ab) into inline math.
    // IMPORTANT: avoid wrapping (a+b) by itself, since that breaks (a+b)^2.
    s = mapOutsideDisplayMathBlocks(s, (chunk) => {
      return chunk.replace(/\(\s*([^\)]+?)\s*\)/g, (m, inner, idx, full) => {
        const v = String(inner);
        if (v.includes("$")) return m;
        // If immediately followed by an exponent, let the ( ... )^n rule handle it.
        const after =
          typeof idx === "number"
            ? String(full).slice(
                idx + String(m).length,
                idx + String(m).length + 6,
              )
            : "";
        if (/^\s*\^/.test(after)) return m;

        // Only wrap term-like parens: contains digits, LaTeX command, or '='.
        const termLike =
          /\d/.test(v) || /\\[A-Za-z]+/.test(v) || v.includes("=");
        if (!termLike) return m;
        if (!looksMathy(v)) return m;
        if (v.includes("=")) return `\n\n$$${v.replace(/\$/g, "")}$$\n\n`;
        return `$${v.replace(/\$/g, "")}$`;
      });
    });

    // Generic fallback: if a line looks like pure math and contains ^ or _ or \\frac/\\sqrt, wrap as display math.
    s = s
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.includes("$$") || t.includes("$") || t.startsWith("```"))
          return line;
        const startsWithMathCommand =
          /^\\(int|oint|iint|iiint|sum|prod|lim|nabla|partial|frac|sqrt)\b/.test(
            t,
          );
        const equationLike =
          /\S/.test(t) &&
          /=/.test(t) &&
          /\\(int|oint|iint|iiint|nabla|partial|cdot|times|mathbf)\b/.test(t);
        const looksLatex =
          /\\(frac|sqrt|sum|int|oint|iint|iiint|left|right|nabla|partial|cdot|times|mathbf)\b/.test(
            t,
          ) || /[_^]/.test(t);
        const looksLikeSentence = /[a-zA-Z].*\s+[a-zA-Z]/.test(t);
        if (startsWithMathCommand) return `\n\n$$${t}$$\n\n`;
        if (equationLike) return `\n\n$$${t}$$\n\n`;
        if (looksLatex && !looksLikeSentence) return `\n\n$$${t}$$\n\n`;
        return line;
      })
      .join("\n");

    s = wrapLatexRuns(s);
    s = normalizeDollarDelimiters(s);

    if (DEBUG_MATH) {
      try {
        console.log("[math][debug] preprocessMath output:", s);
      } catch {}
    }

    return s;
  }

  function renderMessage(text: string) {
    const raw = (text || "").toString();
    let debug = false;
    try {
      debug = localStorage.getItem("curiosity:debugMath") === "1";
    } catch {}
    if (debug) {
      try {
        console.log("[math][debug] raw message:", raw);
      } catch {}
    }
    const v = preprocessMath(raw);
    if (debug) {
      try {
        console.log("[math][debug] rendered markdown source:", v);
        console.log(
          "[math][debug] tip: set localStorage curiosity:debugMath=0 to disable",
        );
      } catch {}
    }
    return (
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex] as any}
        components={{
          p: (props) => (
            <p className="whitespace-pre-wrap leading-6">{props.children}</p>
          ),
          strong: (props) => (
            <strong className="font-semibold">{props.children}</strong>
          ),
        }}
      >
        {v}
      </ReactMarkdown>
    );
  }

  async function openHistory() {
    setArchive(null);
    try {
      let items: HistoryItem[] = [];
      if (user) {
        const ref = fsDoc(database, "users", user.uid, "boards", boardId);
        const snap = await getDoc(ref);
        const data: any = snap.exists() ? snap.data() : null;
        items = Array.isArray(data?.items) ? (data.items as HistoryItem[]) : [];
      } else {
        items = [];
      }
      items.sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setArchive(items);
    } catch (e) {
      console.error("[History] Failed to load board:", e);
      setArchive([]);
    } finally {
      setHistoryOpen(true);
    }
  }

  // If navigated here via the board tile menu's "Chat History" action,
  // automatically open the history sidebar for this board.
  React.useEffect(() => {
    if (!boardId) return;
    let shouldOpen = false;
    try {
      const v = localStorage.getItem("curiosity:openHistoryBoardId");
      if (v && v === String(boardId)) shouldOpen = true;
      if (shouldOpen) localStorage.removeItem("curiosity:openHistoryBoardId");
    } catch {}

    if (shouldOpen) {
      // Defer slightly so routing/state settles before opening overlay.
      setTimeout(() => {
        void openHistory();
      }, 0);
    }
  }, [boardId, user, openHistory]);

  React.useEffect(() => {
    function onAddToCanvasChanged() {
      try {
        const v = localStorage.getItem("addToCanvas");
        setAddToCanvas(v ? v === "true" : false);
      } catch {}
    }

    function onOpenHistory() {
      void openHistory();
    }

    window.addEventListener(
      "curiosity:addToCanvasChanged" as any,
      onAddToCanvasChanged,
    );
    window.addEventListener("curiosity:openHistory" as any, onOpenHistory);
    return () => {
      window.removeEventListener(
        "curiosity:addToCanvasChanged" as any,
        onAddToCanvasChanged,
      );
      window.removeEventListener("curiosity:openHistory" as any, onOpenHistory);
    };
  }, [openHistory]);

  function stopVoiceInput(opts?: { submit?: boolean }) {
    try {
      submitVoiceOnStopRef.current = Boolean(opts?.submit);
      keepListeningRef.current = false;
      suppressCanvasTextRef.current = false;
      const rec = recognitionRef.current;
      if (rec && typeof rec.stop === "function") rec.stop();
    } catch (e) {
      console.error("[Voice] stop failed:", e);
    } finally {
      setIsRecording(false);
    }
  }

  function cancelVoiceInput() {
    submitVoiceOnStopRef.current = false;
    interimRef.current = "";
    finalVoiceRef.current = "";
    stopVoiceInput({ submit: false });
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
      editor.updateInstanceState({ isReadonly: false, isReadOnly: false });
      // Some TLDraw versions expose a direct helper
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyEditor: any = editor as any;
      if (typeof anyEditor.setReadOnly === "function")
        anyEditor.setReadOnly(false);
    } catch {}
    console.log("[Board] Editor mounted:", editor);
    // Force downstream effects (like Firestore snapshot load) to run against
    // the *current* editor instance.
    setEditorReady(false);
    setEditorMountVersion((v) => v + 1);
  }, []);

  // Load persisted TLDraw snapshot + items from Firestore when signed in.
  // This must not live in onMount because onMount captures stale auth state.
  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editorMountVersion || !editor || !boardId) return;

    let cancelled = false;
    (async () => {
      try {
        // If signed out, rely on TLDraw local persistence (persistenceKey) and skip Firestore.
        if (!user) {
          if (!cancelled) setEditorReady(true);
          return;
        }

        isLoadingDocRef.current = true;
        const ref = fsDoc(database, "users", user.uid, "boards", boardId);
        const snap = await getDoc(ref);
        const data: any = snap.exists() ? snap.data() : null;

        const items = Array.isArray(data?.items)
          ? (data.items as HistoryItem[])
          : [];
        if (!cancelled) setBoardItems(items);

        // Smooth refresh behavior:
        // TLDraw local persistence hydrates immediately. We only apply Firestore's snapshot
        // if the server version is newer than what we've last edited locally.
        let localUpdatedAt = 0;
        try {
          const k = `boardLocalUpdatedAt:${user.uid}:${boardId}`;
          const v = localStorage.getItem(k);
          localUpdatedAt = v ? Number(v) || 0 : 0;
        } catch {}

        const remoteUpdatedAt =
          typeof data?.updatedAt === "number" ? data.updatedAt : 0;
        const shouldApplyRemote = remoteUpdatedAt > localUpdatedAt;

        if (shouldApplyRemote && data?.doc) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            loadSnapshot((editor as any).store, data.doc);
            console.log("[Board] Loaded snapshot for", boardId);
            try {
              const k = `boardLocalUpdatedAt:${user.uid}:${boardId}`;
              localStorage.setItem(k, String(remoteUpdatedAt || Date.now()));
            } catch {}
          } catch (e) {
            console.warn("[Board] Failed to load snapshot:", e);
          }
        }
      } catch (e) {
        console.warn("[Board] load doc failed:", e);
      } finally {
        isLoadingDocRef.current = false;
        if (!cancelled) setEditorReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editorMountVersion, user, boardId]);

  // Debounced autosave when the TLDraw store changes
  React.useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !boardId) return;
    if (!user) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store: any = (editor as any).store;

    const saveNow = async () => {
      if (isLoadingDocRef.current) return;
      try {
        const snap = getSnapshot(store);
        const ref = fsDoc(database, "users", user.uid, "boards", boardId);
        const now = Date.now();
        try {
          // IMPORTANT: use updateDoc so the `doc` map is replaced (not deep-merged).
          // This ensures deletions are persisted (merged writes can retain deleted nested keys).
          await updateDoc(ref, {
            doc: snap,
            updatedAt: now,
          });
        } catch (e) {
          // If the document doesn't exist yet (or update fails), fall back to setDoc to create it.
          await setDoc(
            ref,
            {
              id: boardId,
              doc: snap,
              updatedAt: now,
            },
            { merge: true },
          );
        }
        console.log("[Board] autosave ok", boardId);
      } catch (e) {
        console.warn("[Board] autosave failed:", e);
      }
    };

    const unlisten =
      store?.listen?.(
        () => {
          if (isLoadingDocRef.current) return;
          // Track last local edit time so we can decide whether Firestore is newer on refresh.
          try {
            const k = `boardLocalUpdatedAt:${user.uid}:${boardId}`;
            localStorage.setItem(k, String(Date.now()));
          } catch {}
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          saveTimerRef.current = setTimeout(() => {
            void saveNow();
          }, 800);
        },
        {
          // Persist only real document edits caused by the current user (including deletions).
          // This avoids syncing noise and ensures the listener triggers for the changes we care about.
          scope: "document",
          source: "user",
        },
      ) || (() => {});

    function onVisChange() {
      if (document.hidden) {
        if (saveTimerRef.current) {
          try {
            clearTimeout(saveTimerRef.current);
          } catch {}
          saveTimerRef.current = null;
        }
        void saveNow();
      }
    }

    try {
      document.addEventListener("visibilitychange", onVisChange);
    } catch {}
    return () => {
      try {
        // Flush any pending changes before unmount / board switch.
        if (saveTimerRef.current) {
          try {
            clearTimeout(saveTimerRef.current);
          } catch {}
          saveTimerRef.current = null;
          void saveNow();
        }
      } catch {}
      try {
        unlisten();
      } catch {}
      try {
        document.removeEventListener("visibilitychange", onVisChange);
      } catch {}
    };
  }, [boardId, editorReady, user]);

  function addResponseToCanvas(text: string) {
    if (suppressCanvasTextRef.current) return;
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

        // Prepare the image for sending to the API
        const fd = new FormData();

        // If the user asked via voice, allow the request to proceed even if the board is empty.
        // In that case, we omit the image entirely and let the server solve from text + history.
        if (shapeIds.length > 0) {
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

          fd.append(
            "image",
            new File([blob], "board.png", { type: "image/png" }),
          );
        } else {
          if (!questionFromVoice || !questionFromVoice.trim()) {
            alert("Draw or select the problem first.");
            return;
          }
        }
        if (boardId) fd.append("boardId", boardId);
        if (questionFromVoice && questionFromVoice.trim()) {
          fd.append("question", questionFromVoice.trim());
        }
        // Provide history context from client (Firestore-backed for signed-in users)
        const historyForModel = user ? boardItems : [];
        fd.append("history", JSON.stringify(historyForModel));

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
        const questionForUI =
          (questionFromVoice ?? "").toString().trim() || questionText;
        const modeCategory = (raw?.modeCategory ?? raw?.mode_category ?? "")
          .toString()
          .trim();
        addAIItem(finalText, questionForUI, modeCategory);

        // Persist conversation history to Firestore for signed-in users
        if (user) {
          const now = Date.now();
          const entry: HistoryItem = {
            question: questionForUI,
            response: finalText,
            ts: now,
          };
          const nextItems = [...boardItems, entry];
          setBoardItems(nextItems);
          try {
            const ref = fsDoc(database, "users", user.uid, "boards", boardId);
            await setDoc(
              ref,
              {
                id: boardId,
                updatedAt: now,
                items: nextItems,
              },
              { merge: true },
            );
          } catch (e) {
            console.warn("[Board] failed to persist items:", e);
          }
        }

        // Read the current value of addToCanvas from localStorage to ensure we have the latest value
        let shouldAddToCanvas = addToCanvas;
        try {
          const stored = localStorage.getItem("addToCanvas");
          shouldAddToCanvas = stored ? stored === "true" : false;
        } catch {}
        // Optionally create a text shape with the AI response on the canvas
        // For voice questions, never auto-add text to the canvas.
        if (!questionFromVoice && shouldAddToCanvas) {
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
          // Create a text shape with the response
          editor.createShape<TLTextShape>({
            type: "text",
            x,
            y,
            props: {
              richText: toRichText(finalText),
              autoSize: true,
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
    [addToCanvas, boardItems, user],
  );

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
      finalVoiceRef.current = "";
      submitVoiceOnStopRef.current = false;
      keepListeningRef.current = true;
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (event: any) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            finalVoiceRef.current += res[0].transcript + " ";
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
        const spoken = (finalVoiceRef.current || interimRef.current).trim();

        if (submitVoiceOnStopRef.current) {
          submitVoiceOnStopRef.current = false;
          if (spoken) {
            suppressCanvasTextRef.current = true;
            void (askAI(spoken) as any)?.finally?.(() => {
              suppressCanvasTextRef.current = false;
            });
          }
          interimRef.current = "";
          finalVoiceRef.current = "";
          setIsRecording(false);
          suppressCanvasTextRef.current = false;
          return;
        }

        if (keepListeningRef.current) {
          interimRef.current = "";
          finalVoiceRef.current = "";
          try {
            rec.start();
            setIsRecording(true);
          } catch (err) {
            console.error("[Voice] restart failed:", err);
            setIsRecording(false);
          }
          return;
        }

        interimRef.current = "";
        finalVoiceRef.current = "";
        setIsRecording(false);
        suppressCanvasTextRef.current = false;
      };
      setIsRecording(true);
      rec.start();
    } catch (e) {
      console.error("[Voice] start failed:", e);
      setIsRecording(false);
    }
  }

  React.useEffect(() => {
    return () => {
      try {
        keepListeningRef.current = false;
        submitVoiceOnStopRef.current = false;
        const rec = recognitionRef.current;
        if (rec && typeof rec.stop === "function") rec.stop();
      } catch {}
    };
  }, []);

  return (
    <div className="absolute inset-0 flex w-full min-h-0 overflow-hidden bg-white">
      {/* My Boards Sidebar (signed-in users only) */}
      <MyBoardsSidebar currentBoardId={boardId} />

      {/* Canvas area */}
      <div className="relative flex-1 min-w-0 min-h-0 overflow-hidden">
        <div className="absolute inset-0 bg-white">
          <Tldraw
            onMount={onMount}
            key={`${boardId || "default"}`}
            persistenceKey={`board:${user ? user.uid : "anon"}:${
              boardId || "default"
            }`}
            autoFocus
          />
        </div>

        {/* Top-right overlay controls + response stack */}
        <div className="pointer-events-none absolute top-3 right-3 z-20 flex flex-col items-end gap-2">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              onClick={() => {
                if (isRecording) {
                  stopVoiceInput({ submit: true });
                } else {
                  void askAI();
                }
              }}
              disabled={loading}
              className="rounded-xl px-5 py-3 bg-blue-600 text-yellow-400 font-extrabold shadow-lg text-base hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              title="Export board and ask Curiosity"
            >
              <span className="mr-2">✋</span>
              {loading ? "Thinking…" : "Ask Curiosity"}
            </button>
            {isRecording ? (
              <button
                onClick={cancelVoiceInput}
                className="rounded-xl px-4 py-3 font-extrabold shadow-lg text-base border border-neutral-200 transition-colors bg-red-600 text-white hover:bg-red-700"
                title="Cancel voice input"
                aria-label="Cancel voice input"
              >
                <span className="mr-2">✖</span>
                Cancel
              </button>
            ) : (
              <button
                onClick={startVoiceInput}
                className="rounded-xl px-4 py-3 font-extrabold shadow-lg text-base border border-neutral-200 transition-colors bg-white text-neutral-800 hover:bg-neutral-50"
                title="Start voice input"
                aria-label="Start voice input"
              >
                <span className="mr-2">🎤</span>
                Voice
              </button>
            )}
            <button
              onClick={() => setAiItems([])}
              disabled={aiItems.length === 0}
              className="rounded-xl px-4 py-3 border border-neutral-200 bg-white text-neutral-800 shadow-lg text-base font-bold hover:bg-neutral-50 disabled:opacity-50"
              title="Clear all responses"
              aria-label="Clear all responses"
            >
              Clear
            </button>
          </div>

          {/* Newest responses appear at the top. Not scrollable; clear/dismiss to reveal older. */}
          {aiItems.length > 0 && (
            <div
              ref={aiScrollRef}
              className="pointer-events-auto flex flex-col gap-2 items-end max-h-[60vh] overflow-y-auto pr-1"
            >
              {aiItems.map((item) => (
                <div
                  key={item.id}
                  className="curiosity-ai-pop relative w-[280px] max-w-[75vw] rounded-2xl border border-neutral-200 bg-white/95 shadow-sm p-3 pr-12"
                  role="status"
                  aria-live="polite"
                >
                  <div className="text-[11px] text-neutral-400 mb-1">
                    {new Date(item.ts).toLocaleTimeString()}
                    {item.modeCategory ? ` • ${item.modeCategory}` : ""}
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-neutral-900">
                    <div className="curiosity-math-box text-sm text-neutral-900">
                      {renderMessage(item.text)}
                    </div>
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
              ))}
            </div>
          )}
        </div>

        {/* History sidebar (right) */}
        {historyOpen && (
          <aside className="pointer-events-auto absolute inset-y-0 right-0 z-30 w-[360px] max-w-[90vw] border-l border-neutral-200 bg-white shadow-lg flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-200 bg-white">
              <div className="text-sm font-semibold text-neutral-700">
                History
              </div>
              <button
                onClick={() => setHistoryOpen(false)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 bg-white text-neutral-800 shadow-sm text-sm hover:bg-neutral-100"
                title="Close history"
              >
                Close
              </button>
            </div>
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
                        <div className="curiosity-math-box">
                          {renderMessage(it.response)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
