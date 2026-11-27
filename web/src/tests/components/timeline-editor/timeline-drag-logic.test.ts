import { describe, expect, test } from "bun:test";

import {
  dropTargetFor,
  planMove,
  relocate,
  sourceMaxOf,
  trimDraft,
} from "@/components/timeline-editor/timeline/drag-logic";
import {
  addTrack,
  clipEnd,
  clipLength,
  emptyTimeline,
  findClip,
  normalize,
  snapTargets,
} from "@/components/timeline-editor/model";
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

function sample(): EditorTimeline {
  const tl = emptyTimeline();
  const by = (id: string) => tl.tracks.find((t) => t.id === id)!;
  by("main").clips = [clip("a"), clip("b")];
  by("voice1").clips = [
    clip("v1", { type: "audio", startMs: 0, outMs: 3000 }),
    clip("v2", { type: "audio", startMs: 6000, inMs: 3000, outMs: 5000 }),
  ];
  return normalize(tl);
}

describe("素材拖入的落点判定", () => {
  const tl = sample();
  const targets = snapTargets(tl, 0);

  test("视频落在主轨：给出最近的插入位置；音频不能落主轨", () => {
    expect(dropTargetFor(tl, "video", "main", 4100, targets, 50)).toEqual({
      kind: "main",
      index: 1,
    });
    expect(dropTargetFor(tl, "audio", "main", 4100, targets, 50)).toBeNull();
  });

  test("音频落在配音轨：空位可放，压到别的片段标记为不可放", () => {
    expect(dropTargetFor(tl, "audio", "voice1", 4000, targets, 50)).toMatchObject({
      kind: "track",
      trackId: "voice1",
      startMs: 4000,
      ok: true,
    });
    expect(dropTargetFor(tl, "audio", "voice1", 500, targets, 50)).toMatchObject({ ok: false });
  });

  test("起点靠近吸附目标就吸过去；类型不符和锁定的轨没有落点", () => {
    expect(dropTargetFor(tl, "audio", "voice1", 3980, targets, 50)).toMatchObject({
      startMs: 4000,
      snapAt: 4000,
    });
    expect(dropTargetFor(tl, "audio", "overlay1", 1000, targets, 50)).toBeNull();
    expect(dropTargetFor(tl, "video", "overlay1", 1000, targets, 50)).toMatchObject({ ok: true });
    const locked = sample();
    locked.tracks.find((t) => t.id === "voice1")!.locked = true;
    expect(dropTargetFor(locked, "audio", "voice1", 4000, targets, 50)).toBeNull();
    expect(dropTargetFor(tl, "audio", null, 4000, targets, 50)).toBeNull();
  });
});

describe("片段拖动的落点", () => {
  const tl = sample();
  const targets = snapTargets(tl, 0, "v1");

  test("主轨片段在主轨上：按领头的边给出插入位置，总是合法", () => {
    // a 长 4s 往右拖，起点到 3s → 右边缘 7s，越过了 b 的中点 6s
    expect(planMove(tl, "a", "main", 3000, 3000, [], 50, true)).toEqual({
      target: { kind: "main", index: 1 },
      ok: true,
      snapAt: null,
    });
  });

  test("主轨片段拖到叠加轨：可以离开主轨时换轨；占位或失效段（不能离开）留在主轨", () => {
    expect(planMove(tl, "a", "overlay1", 6000, 6000, [], 50, true)).toMatchObject({
      target: { kind: "track", trackId: "overlay1", startMs: 6000 },
      ok: true,
    });
    expect(planMove(tl, "a", "overlay1", 6000, 6000, [], 50, false)?.target).toEqual({
      kind: "main",
      index: 1,
    });
  });

  test("悬停在同类的另一条轨上就换轨，悬停在别的类型的轨上留在原轨", () => {
    const added = addTrack(tl, "audio");
    if ("error" in added) throw new Error(added.error);
    const two = added.timeline;
    expect(planMove(two, "v1", added.trackId, 4000, 4000, targets, 50, true)).toMatchObject({
      target: { kind: "track", trackId: added.trackId, startMs: 4000 },
      ok: true,
    });
    expect(planMove(two, "v1", "overlay1", 4000, 4000, targets, 50, true)?.target).toMatchObject({
      trackId: "voice1",
    });
    expect(planMove(two, "v1", "main", 4000, 4000, targets, 50, true)?.target).toMatchObject({
      trackId: "voice1",
    });
    expect(planMove(two, "v1", null, 4000, 4000, targets, 50, true)?.target).toMatchObject({
      trackId: "voice1",
    });
  });

  test("压到别的片段时 ok 为 false，起点不小于 0，吸附取更近的边", () => {
    expect(planMove(tl, "v1", "voice1", 5000, 5000, targets, 50, true)).toMatchObject({
      ok: false,
    });
    expect(planMove(tl, "v1", "voice1", -400, -400, targets, 50, true)?.target).toMatchObject({
      startMs: 0,
    });
    expect(planMove(tl, "v1", "voice1", 4020, 4020, targets, 50, true)).toMatchObject({
      target: { startMs: 4000 },
      snapAt: 4000,
    });
  });

  test("找不到片段返回 null", () => {
    expect(planMove(tl, "nope", "main", 0, 0, [], 50, true)).toBeNull();
  });

  test("relocate 不做校验地把片段摆到新位置，用来画落点不合法时的样子", () => {
    const moved = relocate(tl, "v1", "voice1", 4500);
    expect(findClip(moved, "v1")!.clip.startMs).toBe(4500);
  });
});

describe("拖边裁剪（带吸附）", () => {
  const tl = sample();

  test("主轨右边拖到播放头附近会吸上去", () => {
    const orig = findClip(tl, "a")!.clip;
    const targets = snapTargets(tl, 3000, "a");
    const { timeline, snapAt } = trimDraft(tl, orig, "end", -980, 4000, targets, 50, true);
    expect(clipLength(findClip(timeline, "a")!.clip)).toBe(3000);
    expect(snapAt).toBe(3000);
  });

  test("关闭吸附或没有靠近的目标时不吸", () => {
    const orig = findClip(tl, "a")!.clip;
    const targets = snapTargets(tl, 3000, "a");
    expect(trimDraft(tl, orig, "end", -980, 4000, targets, 50, false).snapAt).toBeNull();
    expect(trimDraft(tl, orig, "end", -1500, 4000, targets, 50, true).snapAt).toBeNull();
  });

  test("附属轨左边拖到前一段的结束点会吸上去，起点和入点一起动", () => {
    const orig = findClip(tl, "v2")!.clip;
    const targets = snapTargets(tl, 0, "v2");
    const { timeline, snapAt } = trimDraft(tl, orig, "start", -2970, 6000, targets, 50, true);
    const v2 = findClip(timeline, "v2")!.clip;
    expect(v2.startMs).toBe(3000);
    expect(clipEnd(v2)).toBe(8000);
    expect(snapAt).toBe(3000);
  });

  test("素材全长：视频取素材时长，图片 30 秒，文字不限", () => {
    expect(sourceMaxOf(clip("x"), 9000)).toBe(9000);
    expect(sourceMaxOf(clip("x", { type: "image" }), 9000)).toBe(30_000);
    expect(sourceMaxOf(clip("x", { type: "text" }), 0)).toBe(Infinity);
  });
});
