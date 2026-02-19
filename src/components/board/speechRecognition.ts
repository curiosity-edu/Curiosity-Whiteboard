/**
 * Minimal SpeechRecognition typings and helpers.
 *
 * The DOM SpeechRecognition API is not available in all TS environments by
 * default (and differs between browsers), so we keep a minimal compatible
 * surface area here.
 */

type SpeechRecognitionAlternativeLike = { transcript: string };

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
};

export type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

export type SpeechRecognitionErrorEventLike = { error?: string };

export type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

export type WindowWithSpeechRecognition = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

/**
 * Returns the browser-specific SpeechRecognition constructor, if present.
 */
export function getSpeechRecognitionCtor(
  w: Window,
): (new () => SpeechRecognitionLike) | null {
  const ww = w as WindowWithSpeechRecognition;
  return ww.SpeechRecognition || ww.webkitSpeechRecognition || null;
}
