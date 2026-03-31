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
import { preprocessMath } from "@/components/board/math";
import { FaVolumeUp } from "react-icons/fa";
import {
  getSpeechRecognitionCtor,
  type SpeechRecognitionErrorEventLike,
  type SpeechRecognitionEventLike,
  type SpeechRecognitionLike,
} from "@/components/board/speechRecognition";

/**
 * Interactive board page.
 *
 * Responsibilities:
 * - Render the TLDraw canvas for the given `boardId`.
 * - Orchestrate persistence:
 *   - Signed-in users: Firestore-backed snapshot + chat history.
 *   - Signed-out users: TLDraw local persistence only.
 * - Orchestrate the AI solve request and display responses.
 * - Provide optional voice input (Web SpeechRecognition) for hands-free queries.
 *
 * Key invariants:
 * - When signed in, we must not allow "ghost"/local boards: missing Firestore docs redirect to `/`.
 * - We avoid overwriting newer local TLDraw state with an older Firestore snapshot.
 */
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
    audioUrl?: string;
    speechText?: string;
  };
  const [aiItems, setAiItems] = React.useState<AIItem[]>([]);
  const aiScrollRef = React.useRef<HTMLDivElement | null>(null);
  type HistoryItem = { question: string; response: string; ts: number };
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [archive, setArchive] = React.useState<HistoryItem[] | null>(null);
  const historyScrollRef = React.useRef<HTMLDivElement | null>(null);
  const recognitionRef = React.useRef<SpeechRecognitionLike | null>(null);
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

  type AuthUser = { uid: string };
  const rawCtx = UserAuth();
  const ctx = (Array.isArray(rawCtx) ? rawCtx : []) as unknown as [
    AuthUser | null,
    unknown?,
    unknown?,
  ];
  const user = ctx[0];

  const renameModeBoardIdGlobalKey = "curiosity:renameModeBoardId";

  const [suppressCanvasAutoFocus, setSuppressCanvasAutoFocus] =
    React.useState<boolean>(() => {
      try {
        const v = localStorage.getItem(renameModeBoardIdGlobalKey) || "";
        return Boolean(v) && v === String(boardId || "");
      } catch {
        return false;
      }
    });

  React.useEffect(() => {
    function compute() {
      try {
        const v = localStorage.getItem(renameModeBoardIdGlobalKey) || "";
        setSuppressCanvasAutoFocus(Boolean(v) && v === String(boardId || ""));
      } catch {
        setSuppressCanvasAutoFocus(false);
      }
    }
    compute();
    window.addEventListener("curiosity:renameModeChanged", compute);
    return () =>
      window.removeEventListener("curiosity:renameModeChanged", compute);
  }, [renameModeBoardIdGlobalKey, boardId]);

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
        .filter((x: unknown) => x && typeof x === "object")
        .map((x: unknown) => {
          const o = x as Record<string, unknown>;
          return {
            id: String(o.id || ""),
            text: String(o.text || ""),
            ts: Number(o.ts || 0),
            question: o.question ? String(o.question) : undefined,
            modeCategory: o.modeCategory ? String(o.modeCategory) : undefined,
            audioUrl: o.audioUrl ? String(o.audioUrl) : undefined,
            speechText: o.speechText ? String(o.speechText) : undefined,
          };
        })
        .filter((x) => x.id && x.text);
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

  const addAIItem = React.useCallback(
    (
      text: string,
      question?: string,
      modeCategory?: string,
      audioUrl?: string,
      speechText?: string,
    ) => {
      const item: AIItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        question,
        modeCategory,
        audioUrl,
        speechText,
        ts: Date.now(),
      };
      setAiItems((prev) => [item, ...prev]);
    },
    [setAiItems],
  );

  function removeAIItem(id: string) {
    setAiItems((prev) => prev.filter((x) => x.id !== id));
  }

  // Text-to-speech state and utilities
  const [playingAudioId, setPlayingAudioId] = React.useState<string | null>(
    null,
  );
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  // Helper to clean math expressions without special logging
  const cleanMathExpression = React.useCallback((text: string): string => {
    let result = text;
    result = result.replace(
      /\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g,
      "$1 over $2",
    );
    result = result.replace(/\\sqrt\s*\{([^}]*)\}/g, "square root of $1");
    result = result.replace(/\^\s*\{([^}]*)\}/g, "to the power of $1");
    result = result.replace(/_\s*(\{[^}]*\}|\w)/g, "subscript $1");
    result = result.replace(/[{}$|]/g, " ");
    result = result.replace(/\s+/g, " ").trim();
    return result;
  }, []);

  const prepareTextForSpeech = React.useCallback(
    (text: string): string => {
      /**
       * Converts response text to speech-friendly format by:
       * - Handling complex LaTeX expressions (fractions, superscripts, subscripts, sqrt, integrals, etc.)
       * - Converting mathematical symbols to readable text
       * - Removing markdown and formatting
       * - Stripping excessive whitespace
       */
      let processed = text;

      // Handle integrals (∫, ∬, ∮, etc.)
      processed = processed.replace(/\\oint/g, "contour integral");
      processed = processed.replace(/\\iint/g, "double integral");
      processed = processed.replace(/\\iiint/g, "triple integral");
      processed = processed.replace(/\\int/g, "integral");

      // Handle nabla (gradient, divergence, curl operator)
      processed = processed.replace(/\\nabla/g, "nabla");

      // Handle fractions with nested expressions
      processed = processed.replace(
        /\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g,
        (match, numerator, denominator) => {
          // Recursively clean numerator and denominator
          const num = cleanMathExpression(numerator);
          const denom = cleanMathExpression(denominator);
          return `${num} over ${denom}`;
        },
      );

      // Handle square root
      processed = processed.replace(
        /\\sqrt\s*(?:\[([^\]]+)\])?\s*\{([^}]*)\}/g,
        (match, root, content) => {
          const innerText = cleanMathExpression(content);
          return root
            ? `${root} root of ${innerText}`
            : `square root of ${innerText}`;
        },
      );

      // Handle superscripts - special cases for small integers
      processed = processed.replace(/\^\s*\{([^}]*)\}/g, (match, exp) => {
        const cleanExp = exp.trim();
        if (cleanExp === "2") return " squared ";
        if (cleanExp === "3") return " cubed ";
        const processedExp = cleanMathExpression(exp);
        if (/^\d+$/.test(cleanExp)) {
          return ` to the ${cleanExp}th power `;
        }
        return ` to the power of ${processedExp} `;
      });
      processed = processed.replace(/\^([\d])/g, (match, char) => {
        if (char === "2") return " squared ";
        if (char === "3") return " cubed ";
        return ` to the ${char}th power `;
      });
      processed = processed.replace(
        /\^([a-zA-Z])/g,
        (match, char) => ` to the power of ${char} `,
      );

      // Handle subscripts
      processed = processed.replace(
        /_\s*\{([^}]*)\}/g,
        (match, sub) => `subscript ${cleanMathExpression(sub)}`,
      );
      processed = processed.replace(
        /_(\w)/g,
        (match, char) => `subscript ${char}`,
      );

      // Replace Greek letters and mathematical symbols
      processed = processed.replace(/\\alpha/g, "alpha");
      processed = processed.replace(/\\beta/g, "beta");
      processed = processed.replace(/\\gamma/g, "gamma");
      processed = processed.replace(/\\delta/g, "delta");
      processed = processed.replace(/\\pi/g, "pi");
      processed = processed.replace(/\\theta/g, "theta");
      processed = processed.replace(/\\lambda/g, "lambda");
      processed = processed.replace(/\\infty/g, "infinity");
      processed = processed.replace(/\\pm/g, "plus or minus");
      processed = processed.replace(/\\mp/g, "minus or plus");
      processed = processed.replace(/\\times/g, "times");
      processed = processed.replace(/\\div/g, "divided by");
      processed = processed.replace(/\\geq/g, "greater than or equal to");
      processed = processed.replace(/\\leq/g, "less than or equal to");
      processed = processed.replace(/\\neq/g, "not equal to");
      processed = processed.replace(/\\approx/g, "approximately");

      // Remove remaining LaTeX commands and special chars
      processed = processed.replace(/\\[a-zA-Z]+/g, " ");
      processed = processed.replace(/[{}$`|]/g, " ");
      processed = processed.replace(/[*~]/g, "");

      // Clean up extra whitespace
      processed = processed.replace(/\s+/g, " ").trim();

      return processed;
    },
    [cleanMathExpression],
  );

  const generateAudio = React.useCallback(
    async (
      text: string,
    ): Promise<{ url: string; speechText: string } | undefined> => {
      /**
       * Generates audio for the response text and returns both the audio URL and the prepared speech text.
       * Returns undefined if audio generation fails.
       */
      try {
        const speechText = prepareTextForSpeech(text);
        console.debug("[TTS] speechText:", speechText);

        const response = await fetch("/api/speak", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: speechText }),
        });

        if (!response.ok) {
          console.warn("[Audio Generation] API error:", response.status);
          return undefined;
        }

        const audioBlob = await response.blob();
        return {
          url: URL.createObjectURL(audioBlob),
          speechText,
        };
      } catch (e) {
        console.error("[Audio Generation] Error:", e);
        return undefined;
      }
    },
    [prepareTextForSpeech],
  );

  async function speakResponse(
    id: string,
    audioUrl: string | undefined,
    speechText: string | undefined,
  ) {
    /**
     * Plays pre-generated audio or stops playback.
     * If audioUrl is missing or invalid, regenerates from speechText.
     */
    try {
      // Pause current audio if any
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      if (playingAudioId === id) {
        // Toggle off if already playing this item
        setPlayingAudioId(null);
        return;
      }

      let url = audioUrl;

      // If audioUrl is missing, try to regenerate from speechText
      if (!url && speechText) {
        console.warn("[TTS] Audio URL missing, regenerating from speechText");
        try {
          const response = await fetch("/api/speak", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: speechText }),
          });

          if (response.ok) {
            const audioBlob = await response.blob();
            url = URL.createObjectURL(audioBlob);
            // Update the item with the new URL
            setAiItems((prev) =>
              prev.map((item) =>
                item.id === id ? { ...item, audioUrl: url } : item,
              ),
            );
          }
        } catch (e) {
          console.error("[TTS] Failed to regenerate audio:", e);
        }
      }

      if (!url) {
        console.warn("[TTS] No audio URL or speech text available");
        return;
      }

      setPlayingAudioId(id);

      // Create and play audio
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      const audio = audioRef.current;
      audio.src = url;

      audio.onended = () => {
        setPlayingAudioId(null);
      };

      audio.onerror = () => {
        console.error("[TTS] Audio playback error:", audio.error);
        setPlayingAudioId(null);
      };

      void audio.play();
    } catch (e) {
      console.error("[TTS] Playback Error:", e);
      setPlayingAudioId(null);
    }
  }

  React.useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  React.useEffect(() => {
    const el = aiScrollRef.current;
    if (!el) return;
    // Newest messages are inserted at the top; keep the viewport pinned to the top on new items.
    el.scrollTop = 0;
  }, [aiItems.length]);

  function renderMessage(text: string) {
    /**
     * Renders an AI message as markdown + KaTeX.
     *
     * We run the text through `preprocessMath` to normalize delimiters so
     * `remark-math` can reliably parse the content.
     */
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
        rehypePlugins={[rehypeKatex]}
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

  const openHistory = React.useCallback(async () => {
    /**
     * Loads the Q/A history for the current board.
     *
     * Side effects:
     * - Updates `archive` (the displayed history list)
     * - Opens the history sidebar by setting `historyOpen`
     */
    setArchive(null);
    try {
      let items: HistoryItem[] = [];
      if (user) {
        const ref = fsDoc(database, "users", user.uid, "boards", boardId);
        const snap = await getDoc(ref);
        const data: unknown = snap.exists() ? snap.data() : null;
        const obj =
          data && typeof data === "object"
            ? (data as Record<string, unknown>)
            : {};
        const rawItems = obj.items;
        items = Array.isArray(rawItems) ? (rawItems as HistoryItem[]) : [];
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
  }, [user, boardId]);

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
  }, [boardId, openHistory]);

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
      "curiosity:addToCanvasChanged",
      onAddToCanvasChanged,
    );
    window.addEventListener("curiosity:openHistory", onOpenHistory);
    return () => {
      window.removeEventListener(
        "curiosity:addToCanvasChanged",
        onAddToCanvasChanged,
      );
      window.removeEventListener("curiosity:openHistory", onOpenHistory);
    };
  }, [openHistory]);

  function stopVoiceInput(opts?: { submit?: boolean }) {
    /**
     * Stops speech recognition (if running).
     *
     * If `opts.submit` is true, `onend` will treat the buffered transcript as a
     * question and trigger an AI request.
     */
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
    /**
     * TLDraw mount callback.
     *
     * We store the editor instance in a ref and bump a version number so
     * downstream effects (Firestore load, autosave wiring) can re-run against
     * the latest mounted editor.
     */
    editorRef.current = editor;
    try {
      // @ts-expect-error - Update editor state to allow editing
      editor.updateInstanceState({ isReadonly: false, isReadOnly: false });
      // Some TLDraw versions expose a direct helper
      const maybe = editor as unknown as { setReadOnly?: (v: boolean) => void };
      if (typeof maybe.setReadOnly === "function") maybe.setReadOnly(false);
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
    /**
     * Firestore load: hydrate TLDraw snapshot + chat history.
     *
     * Important behavior:
     * - If signed out, we do *not* touch Firestore (TLDraw local persistence only).
     * - If signed in, we only apply the remote snapshot if it is newer than our
     *   locally-edited version (tracked via localStorage timestamps).
     */
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
        const data: unknown = snap.exists() ? snap.data() : null;
        const obj =
          data && typeof data === "object"
            ? (data as Record<string, unknown>)
            : {};

        const items = Array.isArray(obj.items)
          ? (obj.items as HistoryItem[])
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
          typeof obj.updatedAt === "number" ? (obj.updatedAt as number) : 0;
        const shouldApplyRemote = remoteUpdatedAt > localUpdatedAt;

        if (shouldApplyRemote && obj.doc) {
          try {
            const store = (editor as unknown as { store: unknown }).store;
            loadSnapshot(store as never, obj.doc);
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
    /**
     * Debounced autosave for signed-in users.
     *
     * We listen to TLDraw store updates and write the full snapshot to Firestore.
     * `updateDoc` is preferred (to avoid deep merges retaining deleted keys),
     * with a fallback to `setDoc(..., { merge: true })` if the doc doesn't exist.
     */
    const editor = editorRef.current;
    if (!editor || !boardId) return;
    if (!user) return;
    const store = (editor as unknown as { store: unknown }).store;

    const saveNow = async () => {
      if (isLoadingDocRef.current) return;
      try {
        const snap = getSnapshot(store as never);
        const ref = fsDoc(database, "users", user.uid, "boards", boardId);
        const now = Date.now();
        try {
          // IMPORTANT: use updateDoc so the `doc` map is replaced (not deep-merged).
          // This ensures deletions are persisted (merged writes can retain deleted nested keys).
          await updateDoc(ref, {
            doc: snap,
            updatedAt: now,
          });
        } catch {
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
      (
        store as {
          listen?: (
            fn: () => void,
            opts?: { scope?: string; source?: string },
          ) => () => void;
        }
      )?.listen?.(
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
        // Flush pending changes before unmount / board switch.
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
    /**
     * Creates a TLDraw text shape containing the given AI response.
     *
     * This is gated by `suppressCanvasTextRef` to ensure voice-triggered queries
     * do not auto-insert text into the canvas.
     */
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
  function getUnionBounds(editor: Editor, ids: TLShapeId[]) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const id of ids) {
      const b = editor.getShapePageBounds?.(id) ?? null;
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
      /**
       * Main "solve" flow.
       *
       * Steps:
       * - Export selected shapes (or full page) as an image.
       * - POST to `/api/solve` including optional text question + history.
       * - Display the response in the AI panel.
       * - Persist the Q/A entry to Firestore when signed in.
       */
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

        // Generate audio for the response (asynchronously)
        const audioResult = await generateAudio(finalText);
        const audioUrl = audioResult?.url;
        const speechText = audioResult?.speechText;

        addAIItem(finalText, questionForUI, modeCategory, audioUrl, speechText);

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
    [addToCanvas, boardItems, user, addAIItem, boardId, generateAudio],
  );

  // Voice input: start/stop recognition
  function startVoiceInput() {
    /**
     * Starts SpeechRecognition and wires up `onresult`/`onend`.
     *
     * Recognition is used in a "buffer and submit" mode:
     * - We accumulate interim + final transcripts.
     * - On stop, we optionally call `askAI(transcript)`.
     */
    try {
      const SR = getSpeechRecognitionCtor(window);
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
      rec.onresult = (event: SpeechRecognitionEventLike) => {
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
      rec.onerror = (e: SpeechRecognitionErrorEventLike) => {
        console.error("[Voice] error:", e);
      };
      rec.onend = () => {
        const spoken = (finalVoiceRef.current || interimRef.current).trim();

        if (submitVoiceOnStopRef.current) {
          submitVoiceOnStopRef.current = false;
          if (spoken) {
            suppressCanvasTextRef.current = true;
            void Promise.resolve(askAI(spoken)).finally(() => {
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
            autoFocus={!suppressCanvasAutoFocus}
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
                    onClick={() =>
                      void speakResponse(
                        item.id,
                        item.audioUrl,
                        item.speechText,
                      )
                    }
                    className={`absolute bottom-2 right-2 text-base p-1 rounded-md transition-colors ${
                      playingAudioId === item.id
                        ? "text-blue-600 bg-blue-50"
                        : "text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100"
                    }`}
                    title={
                      playingAudioId === item.id ? "Stop audio" : "Play audio"
                    }
                    aria-label={
                      playingAudioId === item.id ? "Stop audio" : "Play audio"
                    }
                    disabled={
                      playingAudioId === item.id ||
                      (!item.audioUrl && !item.speechText)
                    }
                  >
                    <FaVolumeUp />
                  </button>
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
