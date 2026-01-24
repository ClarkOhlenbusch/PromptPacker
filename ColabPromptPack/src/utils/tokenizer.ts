import { getEncoding, Tiktoken } from "js-tiktoken";

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = getEncoding("cl100k_base");
  }
  return encoder;
}

export function countTokens(text: string): number {
  return getEncoder().encode(text).length;
}

export function countTokensForTexts(texts: string[]): number {
  const enc = getEncoder();
  return texts.reduce((sum, text) => sum + enc.encode(text).length, 0);
}
