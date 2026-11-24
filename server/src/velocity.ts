/**
 * Velocity of a pipe in sprints: the points it can take in a sprint. Set by hand, or learned from its last closed
 * sprints — a cautious figure:
 *  1. the last 6 closed sprints, each as points done per week (sprints of different lengths compare);
 *  2. those marked exceptional by hand are left out, and so are outliers: a modified z-score above 3.5
 *     (Iglewicz and Hoaglin: 0.6745 × distance to the median / median absolute deviation), robust on so few values
 *     where a standard deviation is not; when half of the sprints or more did exactly the same, none is an outlier;
 *  3. the "low average": the mean of the values left that are not above their median;
 *  4. times the length of a sprint, in weeks.
 * With fewer than 3 sprints left, the velocity typed in the settings (the initial one) is used.
 */
import type { SprintSettings } from "./sprints.js";

export const WINDOW = 6;
export const MIN_SAMPLES = 3;
/** Modified z-score above which a sprint is an outlier. */
export const OUTLIER_SCORE = 3.5;

export interface ClosedSprint {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  completedPoints: number | null;
  exceptional: boolean;
}

export interface VelocitySample {
  id: string;
  name: string;
  /** Points done per week. */
  perWeek: number;
  /** Why it was left out, if it was. */
  excluded: "exceptional" | "outlier" | null;
}

export interface Velocity {
  /** Points per sprint to plan with; null when none is known. */
  value: number | null;
  /** Where it comes from: typed by hand, learned, or the initial one while too few sprints are closed. */
  source: "manual" | "learned" | "initial";
  /** The learned figure, per week (also when it is not used yet). */
  perWeek: number | null;
  samples: VelocitySample[];
}

export const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const weeksOf = (s: Pick<ClosedSprint, "startsOn" | "endsOn">) =>
  Math.max(1, Math.round((Date.parse(s.endsOn) - Date.parse(s.startsOn)) / 86_400_000) + 1) / 7;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The velocity from the closed sprints (any order) and the settings. */
export function velocity(closed: ClosedSprint[], settings: Pick<SprintSettings, "velocityMode" | "initialVelocity" | "weeks">): Velocity {
  const recent = [...closed].sort((a, b) => b.endsOn.localeCompare(a.endsOn)).slice(0, WINDOW);
  const samples: VelocitySample[] = recent.map((s) => ({
    id: s.id, name: s.name, perWeek: round1((s.completedPoints ?? 0) / weeksOf(s)), excluded: s.exceptional ? "exceptional" : null,
  }));
  const kept = () => samples.filter((s) => !s.excluded);
  const values = kept().map((s) => s.perWeek);
  const m = median(values);
  const mad = median(values.map((v) => Math.abs(v - m)));
  if (values.length >= MIN_SAMPLES) {
    if (mad > 0) for (const s of kept()) if ((0.6745 * Math.abs(s.perWeek - m)) / mad > OUTLIER_SCORE) s.excluded = "outlier";
  }
  const left = kept().map((s) => s.perWeek);
  const low = left.filter((v) => v <= median(left));
  const perWeek = left.length >= MIN_SAMPLES && low.length ? round1(low.reduce((a, b) => a + b, 0) / low.length) : null;
  if (settings.velocityMode === "manual") return { value: settings.initialVelocity, source: "manual", perWeek, samples };
  if (perWeek === null) return { value: settings.initialVelocity, source: "initial", perWeek, samples };
  return { value: Math.round(perWeek * settings.weeks), source: "learned", perWeek, samples };
}
