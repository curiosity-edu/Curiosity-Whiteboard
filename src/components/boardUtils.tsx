/**
 * Pure utility functions for the Board component.
 *
 * This module contains business logic and data transformation functions that
 * do not depend on React state or UI orchestration. It is intentionally UI-free
 * to make these functions reusable and testable.
 */

import { Editor, TLShapeId } from "tldraw";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Converts response text to speech-friendly format.
 * Transforms LaTeX and markdown into natural language equivalents suitable for text-to-speech.
 * Recursively processes nested expressions to ensure consistent transformation at all levels.
 *
 * @param text - The response text (may contain LaTeX, markdown, etc.)
 * @returns Cleaned text optimized for speech synthesis
 *
 * Transformations (applied recursively to nested expressions):
 * - Fractions: \frac{a}{b} → recursively processes numerator and denominator
 * - Square roots: \sqrt{x} → recursively processes content, handles root index
 * - Integrals: \int, \oint, \iint, \iiint → spoken equivalents
 * - Summation: \sum → "summation"
 * - Superscripts: ^{x} → special handling for 2→squared, 3→cubed, recursively processes complex exponents
 * - Subscripts: _{x} → recursively processes subscript content
 * - All Greek letters: alpha through omega
 * - Mathematical operators: =, +, -, ±, ∓, ×, ÷, ≥, ≤, ≠, ≈
 * - LaTeX commands and markdown formatting stripped
 * - Extra whitespace normalized
 */
export function prepareTextForSpeech(text: string): string {
  let processed = text;

  // Handle fractions FIRST with proper nested brace support
  // This regex handles one level of nesting (e.g., \sqrt{...} inside numerator)
  // Pattern: [{non-braces (non-braces, {non-braces}, non-braces)*}]
  const fracRegex =
    /\\frac\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;
  processed = processed.replace(fracRegex, (match, numerator, denominator) => {
    // Recursively process numerator and denominator through full transformation
    const num = prepareTextForSpeech(numerator);
    const denom = prepareTextForSpeech(denominator);
    return ` ${num} over ${denom} `;
  });

  // Handle square root (recursively process content)
  processed = processed.replace(
    /\\sqrt\s*(?:\[([^\]]+)\])?\s*\{([^}]*)\}/g,
    (match, root, content) => {
      // Recursively process content through full transformation
      const innerText = prepareTextForSpeech(content);
      return root
        ? ` ${root} root of ${innerText} `
        : ` square root of ${innerText} `;
    },
  );

  // Handle integrals (∫, ∬, ∮, etc.)
  processed = processed.replace(/\\oint/g, " contour integral ");
  processed = processed.replace(/\\iint/g, " double integral ");
  processed = processed.replace(/\\iiint/g, " triple integral ");
  processed = processed.replace(/\\int/g, " integral ");

  // Handle summation
  processed = processed.replace(/\\sum/g, " summation ");

  // Handle basic arithmetic operators (must be after fractions to avoid breaking regex)
  // Only replace hyphens that are likely minus signs (surrounded by spaces or at word boundaries with numbers)
  processed = processed.replace(/=/g, " equals ");
  processed = processed.replace(/\+/g, " plus ");
  // Replace minus signs only in mathematical contexts:
  // - Hyphens surrounded by whitespace (e.g., "5 - 3")
  // - Hyphens before numbers at word boundaries (e.g., "-5" at start or after space)
  processed = processed.replace(/\s+-\s+/g, " minus ");
  processed = processed.replace(/(^|\s)-(\d)/g, "$1 minus $2");

  // Handle superscripts - special cases for small integers, recursive for complex expressions
  processed = processed.replace(/\^\s*\{([^}]*)\}/g, (match, exp) => {
    const cleanExp = exp.trim();
    if (cleanExp === "2") return " squared ";
    if (cleanExp === "3") return " cubed ";
    if (/^\d+$/.test(cleanExp)) {
      return ` to the ${cleanExp}th power `;
    }
    // Recursively process complex exponents
    const processedExp = prepareTextForSpeech(exp);
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

  // Handle subscripts (recursively process subscript content)
  processed = processed.replace(
    /_\s*\{([^}]*)\}/g,
    (match, sub) => ` subscript ${prepareTextForSpeech(sub)} `,
  );
  processed = processed.replace(
    /_(\w)/g,
    (match, char) => ` subscript ${char} `,
  );

  // Replace ALL Greek letters and mathematical symbols
  processed = processed.replace(/\\alpha/g, " alpha ");
  processed = processed.replace(/\\beta/g, " beta ");
  processed = processed.replace(/\\gamma/g, " gamma ");
  processed = processed.replace(/\\delta/g, " delta ");
  processed = processed.replace(/\\epsilon/g, " epsilon ");
  processed = processed.replace(/\\zeta/g, " zeta ");
  processed = processed.replace(/\\eta/g, " eta ");
  processed = processed.replace(/\\theta/g, " theta ");
  processed = processed.replace(/\\iota/g, " iota ");
  processed = processed.replace(/\\kappa/g, " kappa ");
  processed = processed.replace(/\\lambda/g, " lambda ");
  processed = processed.replace(/\\mu/g, " mu ");
  processed = processed.replace(/\\nu/g, " nu ");
  processed = processed.replace(/\\xi/g, " xi ");
  processed = processed.replace(/\\omicron/g, " omicron ");
  processed = processed.replace(/\\pi/g, " pi ");
  processed = processed.replace(/\\rho/g, " rho ");
  processed = processed.replace(/\\sigma/g, " sigma ");
  processed = processed.replace(/\\tau/g, " tau ");
  processed = processed.replace(/\\upsilon/g, " upsilon ");
  processed = processed.replace(/\\phi/g, " phi ");
  processed = processed.replace(/\\chi/g, " chi ");
  processed = processed.replace(/\\psi/g, " psi ");
  processed = processed.replace(/\\omega/g, " omega ");

  // Capital Greek letters
  processed = processed.replace(/\\Gamma/g, " capital gamma ");
  processed = processed.replace(/\\Delta/g, " capital delta ");
  processed = processed.replace(/\\Theta/g, " capital theta ");
  processed = processed.replace(/\\Lambda/g, " capital lambda ");
  processed = processed.replace(/\\Xi/g, " capital xi ");
  processed = processed.replace(/\\Pi/g, " capital pi ");
  processed = processed.replace(/\\Sigma/g, " capital sigma ");
  processed = processed.replace(/\\Upsilon/g, " capital upsilon ");
  processed = processed.replace(/\\Phi/g, " capital phi ");
  processed = processed.replace(/\\Psi/g, " capital psi ");
  processed = processed.replace(/\\Omega/g, " capital omega ");

  // Mathematical symbols and operators
  processed = processed.replace(/\\nabla/g, " nabla ");
  processed = processed.replace(/\\pm/g, " plus or minus ");
  processed = processed.replace(/\\mp/g, " minus or plus ");
  processed = processed.replace(/\\times/g, " times ");
  processed = processed.replace(/\\cdot/g, " times ");
  processed = processed.replace(/\\div/g, " divided by ");
  processed = processed.replace(/\\geq/g, " is greater than or equal to ");
  processed = processed.replace(/\\leq/g, " is less than or equal to ");
  processed = processed.replace(/\\neq/g, " is not equal to ");
  processed = processed.replace(/\\approx/g, " is approximately ");
  processed = processed.replace(/\\infty/g, " infinity ");

  // Remove remaining LaTeX commands and special chars
  processed = processed.replace(/\\[a-zA-Z]+/g, " ");
  processed = processed.replace(/[{}$`|]/g, " ");
  processed = processed.replace(/[*~]/g, "");

  // Clean up extra whitespace
  processed = processed.replace(/\s+/g, " ").trim();

  return processed;
}

/**
 * Generates audio from text via the /api/speak endpoint with base64 encoding.
 *
 * @param text - The response text to convert to speech
 * @returns Object with responseAudio (base64-encoded MP3) and speechText (prepared text)
 *          OR undefined if audio generation fails
 *
 * Audio is encoded as base64 for efficient storage in database/localStorage.
 * The client can decode and play the audio immediately using data URLs.
 */
export async function generateAudio(
  text: string,
): Promise<{ responseAudio: string; speechText: string } | undefined> {
  try {
    const speechText = prepareTextForSpeech(text);

    // Call /api/speak which now returns base64-encoded audio
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text: speechText }),
    });

    if (!response.ok) {
      return undefined;
    }

    // Parse JSON response with base64 audio
    const data = (await response.json()) as {
      audioBase64?: string;
      speechText?: string;
      mimeType?: string;
    };

    if (!data.audioBase64) {
      return undefined;
    }

    const dataUrl = `data:${data.mimeType || "audio/mpeg"};base64,${data.audioBase64}`;

    return {
      responseAudio: dataUrl,
      speechText: data.speechText || speechText,
    };
  } catch {
    return undefined;
  }
}

/**
 * Renders markdown content with KaTeX math support.
 * Converts markdown text with inline/block LaTeX to JSX with proper math rendering.
 *
 * @param text - The markdown text to render (may contain LaTeX delimiters)
 * @returns JSX element with rendered markdown and math
 *
 * Supports:
 * - Standard markdown (bold, italic, links, lists, etc.)
 * - Inline math: $...$
 * - Block math: $$...$$
 * - Automatic math preprocessing via preprocessMath utility
 *
 * Preconditions:
 * - preprocessMath utility must be available for math delimiter normalization
 */
export function renderMessage(
  text: string,
  preprocessMath: (s: string) => string,
) {
  const raw = (text || "").toString();
  const v = preprocessMath(raw);
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

/**
 * Calculates the bounding box that contains all specified TLDraw shapes.
 *
 * @param editor - The TLDraw editor instance
 * @param ids - Array of shape IDs to calculate bounds for
 * @returns Bounding box object with minX, minY, maxX, maxY, w (width), h (height), cx (center X), cy (center Y)
 *          OR null if no valid shapes found or bounds cannot be calculated
 *
 * Preconditions:
 * - All shape IDs must exist in the editor
 * - Editor must have getShapePageBounds method available
 */
export function getUnionBounds(
  editor: Editor,
  ids: TLShapeId[],
): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
} | null {
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
