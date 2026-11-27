import { describe, expect, test } from "bun:test";

import {
  clipLength,
  emptyTimeline,
  findClip,
  mainTrack,
  normalize,
} from "@/components/timeline-editor/model";
import { placeMedia } from "@/components/timeline-editor/place";
import type { EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

const clip = (id: string, over: Partial<EditorClip> = {}): EditorClip => ({
  id,
  type: "video",
  ref: id,
  startMs: 0,
  inMs: 0,
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
  by(tl, "main").clips = [clip("a"), clip("b")];
  by(tl, "voice1").clips = [clip("v1", { type: "audio", startMs: 0, outMs: 5000 })];
  return normalize(tl);
}

const ok = (r: ReturnType<typeof placeMedia>) => {
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("拖放到指定位置", () => {
  test("视频落在主轨某个插入位置：插入并顺延，选中新片段", () => {
    const r = ok(placeMedia(sample(), clip("n"), { kind: "main", index: 1 }, 0));
    expect(mainTrack(r.timeline).clips.map((c) => c.id)).toEqual(["a", "n", "b"]);
    expect(r.selectId).toBe("n");
  });

  test("音频不能放进主轨", () => {
    expect(
      placeMedia(sample(), clip("n", { type: "audio" }), { kind: "main", index: 0 }, 0),
    ).toEqual({
      error: "这类素材不能放进主轨",
    });
  });

  test("放到叠加轨：起点取落点，补上默认叠加参数", () => {
    const r = ok(
      placeMedia(sample(), clip("n"), { kind: "track", trackId: "overlay1", startMs: 2500 }, 0),
    );
    const placed = findClip(r.timeline, "n")!.clip;
    expect(placed.startMs).toBe(2500);
    expect(placed.overlay).toEqual({ x: 50, y: 50, scale: 100, opacity: 100 });
  });

  test("落点冲突或轨道类型不符：返回原因", () => {
    const tl = sample();
    expect(
      placeMedia(
        tl,
        clip("n", { type: "audio" }),
        { kind: "track", trackId: "voice1", startMs: 1000 },
        0,
      ),
    ).toEqual({ error: "这里已有片段，换个位置" });
    expect(
      placeMedia(tl, clip("n"), { kind: "track", trackId: "voice1", startMs: 9000 }, 0),
    ).toEqual({
      error: "这类片段不能放到这条轨",
    });
  });

  test("文字片段不能当素材放", () => {
    expect(
      placeMedia(sample(), clip("n", { type: "text" }), { kind: "main", index: 0 }, 0),
    ).toEqual({
      error: "这类素材不能放进主轨",
    });
  });
});

describe("点「+」（没有落点）", () => {
  test("视频接在播放头所在主轨段之后；播放头在主轨之外就放最后", () => {
    const tl = sample();
    const mid = ok(placeMedia(tl, clip("n"), null, 1000));
    expect(mainTrack(mid.timeline).clips.map((c) => c.id)).toEqual(["a", "n", "b"]);
    const end = ok(placeMedia(tl, clip("n"), null, 99999));
    expect(mainTrack(end.timeline).clips.map((c) => c.id)).toEqual(["a", "b", "n"]);
    const empty = ok(placeMedia(emptyTimeline(), clip("n"), null, 0));
    expect(mainTrack(empty.timeline).clips.map((c) => c.id)).toEqual(["n"]);
  });

  test("音频放到播放头处空着的音频轨；都占着就新开一条", () => {
    const tl = sample();
    const music = ok(placeMedia(tl, clip("n", { type: "audio" }), null, 1000));
    expect(findClip(music.timeline, "n")!.track.id).toBe("music1");
    expect(findClip(music.timeline, "n")!.clip.startMs).toBe(1000);
    by(tl, "music1").clips = [clip("m", { type: "audio", startMs: 0, outMs: 9000 })];
    const created = ok(placeMedia(tl, clip("n", { type: "audio" }), null, 1000));
    const track = findClip(created.timeline, "n")!.track;
    expect(["voice1", "music1"]).not.toContain(track.id);
    expect(track.kind).toBe("audio");
    expect(clipLength(findClip(created.timeline, "n")!.clip)).toBe(3000);
  });

  test("音频轨已满且都占着：提示腾位置", () => {
    let tl = sample();
    for (let i = 0; i < 4; i++) {
      tl = { tracks: [...tl.tracks, { ...by(tl, "voice1"), id: `x${i}`, clips: [] }] };
    }
    for (const t of tl.tracks) {
      if (t.kind === "audio")
        t.clips = [clip(`f${t.id}`, { type: "audio", startMs: 0, outMs: 9000 })];
    }
    expect(placeMedia(tl, clip("n", { type: "audio" }), null, 1000)).toEqual({
      error: "音频轨已满，先腾出位置",
    });
  });
});
