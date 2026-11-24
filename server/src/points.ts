/**
 * Complexity points of a task, for every task in every pipe: a value of the planning poker scale (Fibonacci-like),
 * or none. They are set by those who edit the task's fields, like its priority.
 */
import { bad } from "./errors.js";

export const POINTS = [0, 1, 2, 3, 5, 8, 13, 21, 40, 100] as const;

/** Points from a request: a value of the scale, or null for none. */
export function cleanPoints(v: unknown): number | null {
  if (v === null || v === "" || v === undefined) return null;
  if (!POINTS.includes(v as 0)) throw bad("Invalid points");
  return v as number;
}

/** A number as points of the scale, rounded up (4 → 5, ½ → 1, above 100 → 100); undefined if not a number ≥ 0. */
export function roundPoints(n: number): number | undefined {
  if (!Number.isFinite(n) || n < 0) return undefined;
  return POINTS.find((p) => p >= n) ?? 100;
}
