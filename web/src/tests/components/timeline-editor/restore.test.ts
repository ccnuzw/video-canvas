import { describe, expect, test } from "bun:test";

import { clipLength, emptyTimeline, findClip, normalize } from "@/components/timeline-editor/model";
import { restoreLength } from "@/components/timeline-editor/restore";
import type { EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

const clip = (id: string, over: Partial<EditorClip> = {}): EditorClip => ({
  id,
  type: "video",
  ref: id,
  startMs: 0,
  inMs: 1000,
  outMs: 3000,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: null,
  host: null,
  ...over,
});

const by = (tl: EditorTimeline, id: string) => tl.tracks.find((t) => t.id === id)!;

function sample(): EditorTimeline {
  const tl = emptyTimeline();
  by(tl, "main").clips = [clip("a"), clip("img", { type: "image", inMs: 0, outMs: 8000 })];
  by(tl, "voice1").clips = [
    clip("v1", { type: "audio", startMs: 0 }),
    clip("v2", { type: "audio", startMs: 4000, inMs: 0, outMs: 1000 }),
  ];
  return normalize(tl);
}

describe("恢复原长", () => {
  test("主轨视频回到素材全长，后面顺延；图片回到默认 3 秒", () => {
    const tl = restoreLength(sample(), "a", 9000);
    expect(clipLength(findClip(tl, "a")!.clip)).toBe(9000);
    expect(findClip(tl, "img")!.clip.startMs).toBe(9000);
    expect(clipLength(findClip(restoreLength(sample(), "img", 0), "img")!.clip)).toBe(3000);
  });

  test("附属音频回到全长，但不超过后一段的起点", () => {
    const tl = restoreLength(sample(), "v1", 9000);
    const v1 = findClip(tl, "v1")!.clip;
    expect([v1.inMs, clipLength(v1)]).toEqual([0, 4000]);
  });

  test("文字不变；找不到返回原对象", () => {
    const tl = sample();
    expect(restoreLength(tl, "nope", 5000)).toBe(tl);
  });
});
