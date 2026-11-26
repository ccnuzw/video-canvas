import { describe, expect, test } from "bun:test";

import { emptyTimeline, normalize } from "@/components/timeline-editor/model";
import {
  activeTexts,
  mainIndexAt,
  mainItems,
  playbackOf,
  soundOf,
  windowMedia,
} from "@/components/timeline-editor/player-plan";
import type { ClipMedia, EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

const clip = (id: string, over: Partial<EditorClip> = {}): EditorClip => ({
  id,
  type: "video",
  ref: id,
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

/** ref 以 ph 开头是占位，bad 开头是失效，其余可用 */
const resolve = (c: EditorClip): ClipMedia => {
  const ref = c.ref ?? "";
  const state = ref.startsWith("ph") ? "placeholder" : ref.startsWith("bad") ? "broken" : "ready";
  return {
    state,
    url: state === "ready" ? `u:${ref}` : null,
    durationMs: 9000,
    label: ref,
    thumbUrl: null,
  };
};

const track = (tl: EditorTimeline, id: string) => tl.tracks.find((t) => t.id === id)!;

/** 主轨 a(4s) b(4s)；叠加轨 o1 在 1–3s；配音 v1 在 2–5s；字幕 s1 在 0–2s */
function sample(): EditorTimeline {
  const tl = emptyTimeline();
  track(tl, "main").clips = [clip("a"), clip("b")];
  track(tl, "overlay1").clips = [
    clip("o1", {
      startMs: 1000,
      outMs: 2000,
      overlay: { x: 30, y: 40, scale: 50, opacity: 80 },
    }),
  ];
  track(tl, "voice1").clips = [clip("v1", { type: "audio", startMs: 2000, outMs: 3000 })];
  track(tl, "text1").clips = [
    clip("s1", {
      type: "text",
      ref: null,
      outMs: 2000,
      text: { text: "你好", style: "subtitle", pos: "bottom", size: 100 },
    }),
  ];
  return normalize(tl);
}

describe("主轨播放项", () => {
  test("带上素材状态，轨道静音时每段都静音", () => {
    const tl = sample();
    track(tl, "main").clips[1] = clip("ph1", { startMs: 4000 });
    let items = mainItems(tl, resolve);
    expect(items.map((i) => i.media.state)).toEqual(["ready", "placeholder"]);
    expect(items.map((i) => i.muted)).toEqual([false, false]);
    track(tl, "main").muted = true;
    items = mainItems(tl, resolve);
    expect(items.every((i) => i.muted)).toBe(true);
  });

  test("mainIndexAt：段内取该段；主轨是最后结束的停在最后一段；附属轨更长则没有主轨画面", () => {
    const items = mainItems(sample(), resolve);
    expect(mainIndexAt(items, 0, 8000)).toBe(0);
    expect(mainIndexAt(items, 4000, 8000)).toBe(1);
    expect(mainIndexAt(items, 8000, 8000)).toBe(1);
    expect(mainIndexAt(items, 8500, 12000)).toBe(-1);
    expect(mainIndexAt([], 0, 0)).toBe(-1);
  });
});

describe("音量与静音", () => {
  test("音量 = 百分比 × 淡变；轨道静音、片段静音、音量 0 都算静音", () => {
    const c = clip("x", { volume: 150, fadeInMs: 1000, outMs: 4000 });
    expect(soundOf(c, false, 500)).toEqual({ muted: false, gain: 0.75 });
    expect(soundOf(c, false, 2000).gain).toBe(1.5);
    expect(soundOf(c, true, 2000).muted).toBe(true);
    expect(soundOf({ ...c, muted: true }, false, 2000).muted).toBe(true);
    expect(soundOf({ ...c, volume: 0 }, false, 2000).muted).toBe(true);
  });
});

describe("窗口内要挂载的媒体", () => {
  test("只含窗口内的视频/图片/音频，不含文字、失效和主轨", () => {
    const tl = sample();
    track(tl, "music1").clips = [clip("far", { type: "audio", startMs: 30000, outMs: 1000 })];
    track(tl, "voice1").clips.push(clip("bad1", { type: "audio", ref: "bad1", startMs: 6000 }));
    const ids = windowMedia(tl, resolve, 1000, 1500).map((m) => m.id);
    expect(ids).toEqual(["o1", "v1"]);
    // 窗口外的 v1 不在；远处的 far 一直不在
    expect(windowMedia(tl, resolve, 9000, 1500).map((m) => m.id)).toEqual([]);
  });

  test("叠加轨从下往上排：上面的轨在后面，才会盖住下面的", () => {
    const tl = emptyTimeline();
    tl.tracks.splice(1, 0, { ...track(tl, "overlay1"), id: "overlay2", clips: [] });
    track(tl, "overlay1").clips = [
      clip("low", { overlay: { x: 50, y: 50, scale: 100, opacity: 100 } }),
    ];
    track(tl, "overlay2").clips = [
      clip("high", { overlay: { x: 50, y: 50, scale: 100, opacity: 100 } }),
    ];
    expect(windowMedia(tl, resolve, 0, 1500).map((m) => m.id)).toEqual(["low", "high"]);
  });

  test("视频叠加是 video，图片叠加是 image，音频轨是 audio", () => {
    const tl = sample();
    track(tl, "overlay1").clips.push(
      clip("img", {
        type: "image",
        startMs: 5000,
        outMs: 3000,
        overlay: { x: 50, y: 50, scale: 100, opacity: 100 },
      }),
    );
    const kinds = Object.fromEntries(
      windowMedia(tl, resolve, 2000, 5000).map((m) => [m.id, m.kind]),
    );
    expect(kinds).toEqual({ o1: "video", img: "image", v1: "audio" });
  });
});

describe("某一时刻的播放状态", () => {
  test("活动片段：素材内位置、不透明度乘淡变、可见", () => {
    const tl = sample();
    const o1 = track(tl, "overlay1").clips[0];
    track(tl, "overlay1").clips[0] = { ...o1, fadeInMs: 1000 };
    const m = windowMedia(tl, resolve, 1500, 1500).find((x) => x.id === "o1")!;
    const pb = playbackOf(m, 1500);
    expect(pb.active).toBe(true);
    expect(pb.sourceMs).toBe(500);
    expect(pb.visible).toBe(true);
    expect(pb.opacity).toBeCloseTo(0.8 * 0.5);
  });

  test("没到或已过：不活动、不可见；隐藏的叠加轨静音且不可见；静音轨静音", () => {
    const tl = sample();
    const m = windowMedia(tl, resolve, 500, 1500).find((x) => x.id === "o1")!;
    expect(playbackOf(m, 500)).toMatchObject({ active: false, visible: false });
    track(tl, "overlay1").hidden = true;
    track(tl, "voice1").muted = true;
    const hidden = windowMedia(tl, resolve, 2200, 1500);
    expect(
      playbackOf(
        hidden.find((x) => x.id === "o1")!,
        2200,
      ),
    ).toMatchObject({
      visible: false,
      muted: true,
    });
    expect(
      playbackOf(
        hidden.find((x) => x.id === "v1")!,
        2200,
      ).muted,
    ).toBe(true);
  });
});

describe("字幕", () => {
  test("只取此刻在播且轨道没隐藏的文字", () => {
    const tl = sample();
    expect(activeTexts(tl, 1000).map((c) => c.id)).toEqual(["s1"]);
    expect(activeTexts(tl, 2500)).toEqual([]);
    track(tl, "text1").hidden = true;
    expect(activeTexts(tl, 1000)).toEqual([]);
  });
});
