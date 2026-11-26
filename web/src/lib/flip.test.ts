import { afterEach, describe, expect, it, vi } from "vitest";
import { notePlaces, playMoves } from "./flip";

const rect = (left: number, top: number) => ({ left, top, width: 200, height: 60, right: left + 200, bottom: top + 60, x: left, y: top, toJSON() {} }) as DOMRect;

/** A board with cards at given places; each card records its animations. */
function board(cards: Record<string, [number, number]>) {
  document.body.innerHTML = Object.keys(cards).map((id) => `<div data-task-card="${id}"></div>`).join("");
  const animations: Record<string, Keyframe[][]> = {};
  for (const el of document.querySelectorAll<HTMLElement>("[data-task-card]")) {
    const id = el.dataset.taskCard!;
    el.getBoundingClientRect = () => rect(...cards[id]);
    animations[id] = [];
    el.animate = ((frames: Keyframe[]) => {
      animations[id].push(frames);
      return { onfinish: null, oncancel: null } as unknown as Animation;
    }) as typeof el.animate;
  }
  return animations;
}

afterEach(() => vi.unstubAllGlobals());

describe("cards gliding to their new place", () => {
  it("slide a moved card from where it was, fade a new one in, leave the others", () => {
    board({ a: [0, 0], b: [0, 80] });
    const before = notePlaces();
    const anim = board({ a: [240, 0], b: [0, 80], c: [0, 160] });
    playMoves(before);
    expect(anim.a[0][0].transform).toBe("translate(-240px, 0px)");
    expect(anim.b).toHaveLength(0);
    expect(anim.c[0][0]).toMatchObject({ opacity: 0 });
  });

  it("do nothing on the first load, nor for those who want less motion", () => {
    const anim = board({ a: [0, 0] });
    playMoves(new Map());
    expect(anim.a).toHaveLength(0);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    board({ a: [0, 0] });
    const before = notePlaces();
    const again = board({ a: [300, 0] });
    playMoves(before);
    expect(again.a).toHaveLength(0);
  });
});
