/**
 * Math / LaTeX preprocessing helpers used by the whiteboard AI responses.
 *
 * The AI model sometimes emits TeX fragments with inconsistent delimiter usage
 * (e.g. `\( ... \)` / `\[ ... \]` / stray `$` / `$$` blocks in prose).
 *
 * This module keeps the normalization logic isolated so the Board component can
 * focus on UI and orchestration.
 */

/**
 * Best-effort normalization of math delimiters for `remark-math` + KaTeX.
 *
 * This intentionally uses heuristics and must be conservative:
 * we try to improve rendering without destructively rewriting valid TeX.
 */
export function preprocessMath(text: string): string {
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

    // Collapse accidental $$$ or longer runs into $$.
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
      const isInlineContext = (before && before !== "\n") || (after && after !== "\n");

      const hasStrongMathSignal =
        /\\(frac|sqrt|sum|int|oint|iint|iiint|nabla|partial|cdot|times|mathbf|left|right)\b/.test(
          inner,
        ) || /[=^_]/.test(noNested);

      // If $$...$$ is used inline within a sentence, treat it as inline math.
      // Otherwise remark-math parsing is brittle and we risk mangling it.
      if (isInlineContext && !noNested.includes("\n") && noNested.length < 240) {
        return `$${noNested}$`;
      }

      // If the model incorrectly wrapped a full sentence in $$...$$, unwrap it.
      // But never unwrap blocks that have strong math signals (e.g. Stokes).
      if (!hasStrongMathSignal && looksLikeProse(noNested)) {
        // Try to extract a leading equation-like chunk, stopping before common prose linkers.
        // Example: "a+b^2 = a^2 + b^2 is that it doesn't..." -> "$a+b^2 = a^2 + b^2$ is that it doesn't..."
        const linkerMatch = noNested.match(/\b(is|are|was|were|that|which|because|since)\b/i);
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
      const isInline = (before && before !== "\n") || (after && after !== "\n");
      if (!isInline) return m;
      return `$${String(inner).trim()}$`;
    });
    return out;
  }

  s = normalizeDollarDelimiters(s);

  function mapOutsideMathAndCode(input: string, fn: (chunk: string) => string) {
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
}
