import { describe, expect, test } from "bun:test";

import {
  clipLength,
  emptyTimeline,
  findClip,
  mainTrack,
  normalize,
} from "@/components/timeline-editor/model";
import { mainSlotAt, moveClipTo } from "@/components/timeline-editor/move";
import type { EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

const clip = (id: string, over: Partial<EditorClip> = {}): EditorClip => ({
  id,
  type: "video",
  ref: `r:${id}`,
  startMs: 0,
  inMs: 0,
  outMs: 4000,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: null,
  host: null,
  ...over,
});

/** 主轨 a(4s) b(4s) c(2s)；叠加轨 o1 在 1–3s；配音 v1 */
function sample(): EditorTimeline {
  const tl = emptyTimeline();
  const by = (id: string) => tl.tracks.find((t) => t.id === id)!;
  by("main").clips = [clip("a"), clip("b"), clip("c", { outMs: 2000 })];
  by("overlay1").clips = [
    clip("o1", { startMs: 1000, outMs: 2000, overlay: { x: 70, y: 30, scale: 40, opacity: 90 } }),
  ];
  by("voice1").clips = [clip("v1", { type: "audio", outMs: 3000 })];
  return normalize(tl);
}
const mainIds = (tl: EditorTimeline) => mainTrack(tl).clips.map((c) => c.id);

describe("主轨插入位置（按拖动方向看领头的边）", () => {
  test("没动时就是原位置", () => {
    const tl = sample();
    expect(mainSlotAt(tl, "a", 0, 0)).toBe(0);
    expect(mainSlotAt(tl, "b", 4000, 4000)).toBe(1);
    expect(mainSlotAt(tl, "c", 8000, 8000)).toBe(2);
  });

  test("往左拖看左边缘：越过前面某段的中点就排到它前面", () => {
    const tl = sample();
    // 拖 c（原在 8–10s）：a 中点 2s、b 中点 6s
    expect(mainSlotAt(tl, "c", 6500, 0)).toBe(2);
    expect(mainSlotAt(tl, "c", 5500, 0)).toBe(1);
    expect(mainSlotAt(tl, "c", 1500, 0)).toBe(0);
  });

  test("往右拖看右边缘：越过后面某段的中点就排到它后面", () => {
    const tl = sample();
    // 拖 a（原在 0–4s，长 4s）：b 中点 6s、c 中点 9s
    expect(mainSlotAt(tl, "a", 1500, 0)).toBe(0);
    expect(mainSlotAt(tl, "a", 2500, 0)).toBe(1);
    expect(mainSlotAt(tl, "a", 5500, 0)).toBe(2);
  });

  test("很长的片段往前拖到很短的片段前面（中心点永远过不去的情况）", () => {
    const tl = emptyTimeline();
    tl.tracks.find((t) => t.id === "main")!.clips = [
      clip("short", { outMs: 600 }),
      clip("long", { outMs: 9000 }),
    ];
    const packed = normalize(tl);
    // long 原在 0.6–9.6s；左边缘拖到 0.2s，越过了 short 的中点 0.3s
    expect(mainSlotAt(packed, "long", 200, 0)).toBe(0);
    expect(mainSlotAt(packed, "long", 400, 0)).toBe(1);
  });

  test("从别的轨拖进来：看指针落在主轨哪段的哪一半", () => {
    const tl = sample();
    expect(mainSlotAt(tl, "o1", 0, 1000)).toBe(0);
    expect(mainSlotAt(tl, "o1", 0, 4500)).toBe(1);
    expect(mainSlotAt(tl, "o1", 0, 6500)).toBe(2);
    expect(mainSlotAt(tl, "o1", 0, 99999)).toBe(3);
  });
});

describe("移动到目标位置", () => {
  test("主轨内调顺序：后面的让位、首尾相接", () => {
    const ok = moveClipTo(sample(), "a", { kind: "main", index: 2 });
    if ("error" in ok) throw new Error(ok.error);
    expect(mainIds(ok.timeline)).toEqual(["b", "c", "a"]);
    expect(findClip(ok.timeline, "a")!.clip.startMs).toBe(6000);
  });

  test("主轨片段拖到叠加轨：主轨合上空位，叠加轨按起点放下并带默认叠加参数", () => {
    const ok = moveClipTo(sample(), "b", { kind: "track", trackId: "overlay1", startMs: 5000 });
    if ("error" in ok) throw new Error(ok.error);
    expect(mainIds(ok.timeline)).toEqual(["a", "c"]);
    expect(findClip(ok.timeline, "c")!.clip.startMs).toBe(4000);
    const moved = findClip(ok.timeline, "b")!;
    expect(moved.track.id).toBe("overlay1");
    expect(moved.clip.startMs).toBe(5000);
    expect(moved.clip.overlay).toEqual({ x: 50, y: 50, scale: 100, opacity: 100 });
    expect(clipLength(moved.clip)).toBe(4000);
  });

  test("叠加片段拖回主轨：插到对应位置，叠加参数去掉", () => {
    const ok = moveClipTo(sample(), "o1", { kind: "main", index: 1 });
    if ("error" in ok) throw new Error(ok.error);
    expect(mainIds(ok.timeline)).toEqual(["a", "o1", "b", "c"]);
    const moved = findClip(ok.timeline, "o1")!;
    expect(moved.clip.overlay).toBeNull();
    expect(moved.clip.startMs).toBe(4000);
    expect(ok.timeline.tracks.find((t) => t.id === "overlay1")!.clips).toEqual([]);
  });

  test("落到附属轨会压到别的片段时失败", () => {
    expect(
      moveClipTo(sample(), "b", { kind: "track", trackId: "overlay1", startMs: 2000 }),
    ).toEqual({
      error: "这里已有片段，换个位置",
    });
  });

  test("类型不符的轨不能放：音频不能进主轨，视频不能进配音轨", () => {
    expect(moveClipTo(sample(), "v1", { kind: "main", index: 0 })).toEqual({
      error: "这类片段不能放到这条轨",
    });
    expect(moveClipTo(sample(), "a", { kind: "track", trackId: "voice1", startMs: 9000 })).toEqual({
      error: "这类片段不能放到这条轨",
    });
  });

  test("锁定的轨（来源或目标）不能动", () => {
    const tl = sample();
    tl.tracks.find((t) => t.id === "overlay1")!.locked = true;
    expect(moveClipTo(tl, "b", { kind: "track", trackId: "overlay1", startMs: 5000 })).toEqual({
      error: "这条轨已锁定",
    });
    expect(moveClipTo(tl, "o1", { kind: "main", index: 0 })).toEqual({ error: "这条轨已锁定" });
  });

  test("原地不动返回原对象；找不到片段报错", () => {
    const tl = sample();
    const same = moveClipTo(tl, "a", { kind: "main", index: 0 });
    if ("error" in same) throw new Error(same.error);
    expect(same.timeline).toBe(tl);
    expect(moveClipTo(tl, "nope", { kind: "main", index: 0 })).toEqual({ error: "找不到这一段" });
  });
});
