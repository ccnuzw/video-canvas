import { describe, expect, test } from "bun:test";

import {
  addSubtitle,
  muteCommand,
  removeCommand,
  replaceTrackClips,
  restoreCommand,
  splitCommand,
  targetClipId,
  trimCommand,
} from "@/components/timeline-editor/timeline/edit-actions";
import {
  clipLength,
  emptyTimeline,
  findClip,
  mainTrack,
  normalize,
  textClip,
} from "@/components/timeline-editor/model";
import type { ClipMedia, EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

let n = 0;
const ids = () => `n${++n}`;

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
  by("main").clips = [clip("a"), clip("ph"), clip("c", { type: "image", outMs: 3000 })];
  by("voice1").clips = [
    clip("v1", { type: "audio", startMs: 0, outMs: 3000, inMs: 500 }),
    clip("v2", { type: "audio", startMs: 5000, outMs: 2000 }),
  ];
  return normalize(tl);
}

const media = (state: ClipMedia["state"], durationMs = 9000): ClipMedia => ({
  state,
  url: state === "ready" ? "u" : null,
  durationMs,
  label: "x",
  thumbUrl: null,
});
const resolve = (c: EditorClip): ClipMedia =>
  c.id === "ph" ? media("placeholder") : c.id === "bad" ? media("broken") : media("ready");

describe("编辑命令的目标", () => {
  test("有选中就用选中的，否则用播放头所在的主轨片段", () => {
    const tl = sample();
    expect(targetClipId(tl, "v1", 100)).toBe("v1");
    expect(targetClipId(tl, null, 5000)).toBe("ph");
    expect(targetClipId(tl, null, 99999)).toBeNull();
    expect(targetClipId(tl, "gone", 100)).toBe("a");
  });
});

describe("拆分与裁剪命令", () => {
  test("拆分选中的附属片段，并选中后一半", () => {
    const r = splitCommand(sample(), resolve, "v1", 1500, ids);
    if ("error" in r) throw new Error(r.error);
    expect(r.selectId).toBeTruthy();
    expect(findClip(r.timeline, "v1")).not.toBeNull();
  });

  test("没选中且播放头不在主轨片段上时提示；待采用占位不能拆分、不能裁剪", () => {
    expect(splitCommand(sample(), resolve, null, 99999, ids)).toEqual({
      error: "先选中一段，或把播放头放到主轨的片段上",
    });
    expect(splitCommand(sample(), resolve, "ph", 5000, ids)).toEqual({
      error: "待采用的片段不能拆分",
    });
    expect(trimCommand(sample(), resolve, "ph", 5000, "left")).toEqual({
      error: "待采用的片段不能裁剪",
    });
  });

  test("素材失效的片段不能拆分", () => {
    const tl = sample();
    mainTrack(tl).clips[0] = clip("bad");
    expect(splitCommand(normalize(tl), resolve, "bad", 1000, ids)).toEqual({
      error: "素材已失效，请先换版本或删掉",
    });
  });

  test("文字片段不查素材，直接按时长拆分", () => {
    const tl = sample();
    tl.tracks[0].clips = [textClip(1000, ids)];
    const id = tl.tracks[0].clips[0].id;
    const r = splitCommand(tl, resolve, id, 2000, ids);
    expect("error" in r).toBe(false);
  });

  test("向左裁返回播放头位置", () => {
    const r = trimCommand(sample(), resolve, "a", 1000, "left");
    if ("error" in r) throw new Error(r.error);
    expect(r.playhead).toBe(0);
    expect(clipLength(findClip(r.timeline, "a")!.clip)).toBe(3000);
  });
});

describe("删除、静音、恢复原长", () => {
  test("删除：没选中提示；锁定的轨不能删", () => {
    expect(removeCommand(sample(), null)).toEqual({ error: "先选中一段" });
    const locked = sample();
    locked.tracks.find((t) => t.id === "voice1")!.locked = true;
    expect(removeCommand(locked, "v1")).toEqual({ error: "这条轨已锁定" });
    const r = removeCommand(sample(), "v1");
    if ("error" in r) throw new Error(r.error);
    expect(findClip(r.timeline, "v1")).toBeNull();
  });

  test("静音切换", () => {
    const r = muteCommand(sample(), "v1");
    if ("error" in r) throw new Error(r.error);
    expect(findClip(r.timeline, "v1")!.clip.muted).toBe(true);
  });

  test("恢复原长：主轨视频回素材全长，图片回 3 秒；附属轨不超过后一段", () => {
    const tl = sample();
    const main = restoreCommand(tl, resolve, "a");
    if ("error" in main) throw new Error(main.error);
    expect(clipLength(findClip(main.timeline, "a")!.clip)).toBe(9000);
    const img = restoreCommand(tl, resolve, "c");
    if ("error" in img) throw new Error(img.error);
    expect(clipLength(findClip(img.timeline, "c")!.clip)).toBe(3000);
    // v1 起点 0，后一段 v2 在 5000，素材 9000 → 最长到 5000
    const att = restoreCommand(tl, resolve, "v1");
    if ("error" in att) throw new Error(att.error);
    const v1 = findClip(att.timeline, "v1")!.clip;
    expect([v1.inMs, clipLength(v1)]).toEqual([0, 5000]);
  });
});

describe("字幕", () => {
  test("在播放头处加一条字幕并返回它的 ID；播放头处已有字幕失败", () => {
    const tl = sample();
    const r = addSubtitle(tl, "text1", 1000, ids);
    if ("error" in r) throw new Error(r.error);
    expect(findClip(r.timeline, r.selectId)!.clip.startMs).toBe(1000);
    expect(addSubtitle(r.timeline, "text1", 1500, ids)).toEqual({
      error: "播放头处已有字幕",
    });
  });

  test("按台词生成：整条字幕轨替换成宿主给的片段，锁定时失败", () => {
    const tl = sample();
    const made = [textClip(0, ids), textClip(3000, ids)];
    const r = replaceTrackClips(tl, "text1", made);
    if ("error" in r) throw new Error(r.error);
    expect(r.tracks.find((t) => t.id === "text1")!.clips).toHaveLength(2);
    tl.tracks[0].locked = true;
    expect(replaceTrackClips(tl, "text1", made)).toEqual({ error: "这条轨已锁定" });
  });
});
