import { describe, expect, test } from "bun:test";

import {
  addAttached,
  addTrack,
  clipLength,
  emptyTimeline,
  findClip,
  gainAt,
  insertMain,
  mainTrack,
  moveAttached,
  moveMain,
  normalize,
  overlapsAt,
  pickAudioTrack,
  removeClip,
  removeTrack,
  snapMove,
  snapTime,
  splitAt,
  textClip,
  timelineEnd,
  trackBadge,
  trimEdge,
  trimToPlayhead,
  updateClip,
} from "@/components/timeline-editor/model";
import type { EditorClip, EditorTimeline } from "@/components/timeline-editor/types";

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

/** 主轨三段（4s、4s、2s）+ 叠加轨一段 + 配音轨两段 */
function sample(): EditorTimeline {
  const tl = emptyTimeline();
  const by = (id: string) => tl.tracks.find((t) => t.id === id)!;
  by("main").clips = [clip("a"), clip("b"), clip("c", { outMs: 2000 })];
  by("overlay1").clips = [
    clip("o1", { startMs: 1000, outMs: 2000, overlay: { x: 50, y: 50, scale: 100, opacity: 100 } }),
  ];
  by("voice1").clips = [
    clip("v1", { type: "audio", startMs: 0, outMs: 3000 }),
    clip("v2", { type: "audio", startMs: 5000, outMs: 2000 }),
  ];
  return normalize(tl);
}

const startOf = (tl: EditorTimeline, id: string) => findClip(tl, id)!.clip.startMs;
const lenOf = (tl: EditorTimeline, id: string) => clipLength(findClip(tl, id)!.clip);

describe("默认时间线与基础查询", () => {
  test("默认 5 条轨：字幕、叠加、主轨、配音、BGM，主轨 id 固定", () => {
    const tl = emptyTimeline();
    expect(tl.tracks.map((t) => [t.id, t.kind, t.role])).toEqual([
      ["text1", "text", null],
      ["overlay1", "overlay", null],
      ["main", "main", null],
      ["voice1", "audio", "voice"],
      ["music1", "audio", "music"],
    ]);
    expect(mainTrack(tl).id).toBe("main");
  });

  test("normalize 让主轨片段首尾相接；总长取所有轨的最大结束点", () => {
    const tl = sample();
    expect(["a", "b", "c"].map((id) => startOf(tl, id))).toEqual([0, 4000, 8000]);
    expect(timelineEnd(tl)).toBe(10000);
    const longer = updateClip(tl, "v2", { startMs: 20000 });
    expect(timelineEnd(longer)).toBe(22000);
  });

  test("轨道编号：V1 主轨，叠加越靠上编号越大，音频 A1 起", () => {
    let tl = emptyTimeline();
    const added = addTrack(tl, "overlay");
    if ("error" in added) throw new Error(added.error);
    tl = added.timeline;
    const overlays = tl.tracks.filter((t) => t.kind === "overlay");
    expect(overlays.map((t) => trackBadge(tl, t))).toEqual(["V3", "V2"]);
    expect(trackBadge(tl, mainTrack(tl))).toBe("V1");
    expect(tl.tracks.filter((t) => t.kind === "audio").map((t) => trackBadge(tl, t))).toEqual([
      "A1",
      "A2",
    ]);
    expect(trackBadge(tl, tl.tracks[0])).toBe("T1");
  });
});

describe("拆分与裁到播放头", () => {
  test("主轨拆分：一段变两段，后面的顺延；离边缘太近失败", () => {
    const tl = sample();
    const ok = splitAt(tl, "b", 6000, ids);
    if ("error" in ok) throw new Error(ok.error);
    const main = mainTrack(ok.timeline).clips;
    expect(main.map(clipLength)).toEqual([4000, 2000, 2000, 2000]);
    expect(main[1].outMs).toBe(2000);
    expect(main[2].inMs).toBe(2000);
    expect(main[2].fadeInMs).toBe(0);
    expect(ok.selectId).toBe(main[2].id);
    expect(splitAt(tl, "b", 4200, ids)).toEqual({ error: "离段边缘太近（每段至少 0.5 秒）" });
    expect(splitAt(tl, "b", 20000, ids)).toEqual({ error: "播放头不在这一段上" });
  });

  test("附属轨拆分：两段同轨相接，后一段入点后移", () => {
    const tl = sample();
    const ok = splitAt(tl, "v1", 1500, ids);
    if ("error" in ok) throw new Error(ok.error);
    const track = ok.timeline.tracks.find((t) => t.id === "voice1")!;
    const first = track.clips.find((c) => c.id === "v1")!;
    const second = track.clips.find((c) => c.id === ok.selectId)!;
    expect([first.startMs, clipLength(first)]).toEqual([0, 1500]);
    expect([second.startMs, second.inMs, clipLength(second)]).toEqual([1500, 1500, 1500]);
  });

  test("图片拆分：两段都从 0 起算时长", () => {
    let tl = sample();
    tl = updateClip(tl, "b", { type: "image", outMs: 4000 });
    const ok = splitAt(tl, "b", 6000, ids);
    if ("error" in ok) throw new Error(ok.error);
    const [, b1, b2] = mainTrack(ok.timeline).clips;
    expect([b1.inMs, b1.outMs, b2.inMs, b2.outMs]).toEqual([0, 2000, 0, 2000]);
  });

  test("锁定的轨不能拆分", () => {
    const tl = sample();
    tl.tracks.find((t) => t.id === "voice1")!.locked = true;
    expect(splitAt(tl, "v1", 1500, ids)).toEqual({ error: "这条轨已锁定" });
  });

  test("向左裁：删掉播放头左边，主轨后面前移，播放头回到段首", () => {
    const tl = sample();
    const ok = trimToPlayhead(tl, "b", 5000, "left");
    if ("error" in ok) throw new Error(ok.error);
    expect(lenOf(ok.timeline, "b")).toBe(3000);
    expect(findClip(ok.timeline, "b")!.clip.inMs).toBe(1000);
    expect(startOf(ok.timeline, "c")).toBe(7000);
    expect(ok.playhead).toBe(4000);
  });

  test("向右裁附属片段：只缩短自己，不影响别的轨", () => {
    const tl = sample();
    const ok = trimToPlayhead(tl, "v1", 2000, "right");
    if ("error" in ok) throw new Error(ok.error);
    expect(lenOf(ok.timeline, "v1")).toBe(2000);
    expect(startOf(ok.timeline, "c")).toBe(8000);
    expect(trimToPlayhead(tl, "v1", 100, "right")).toEqual({
      error: "裁完不足 0.5 秒，请改用删除",
    });
  });
});

describe("拖边裁剪", () => {
  test("主轨拖右边：不超出素材长度，后面的顺延", () => {
    const tl = sample();
    const orig = findClip(tl, "b")!.clip;
    const longer = trimEdge(tl, orig, "end", 5000, 6000);
    expect(lenOf(longer, "b")).toBe(6000);
    expect(startOf(longer, "c")).toBe(10000);
    const shorter = trimEdge(tl, orig, "end", -9000, 6000);
    expect(lenOf(shorter, "b")).toBe(500);
  });

  test("附属视频拖左边：起点和入点一起动，不越过前一段的结束点", () => {
    let tl = sample();
    tl = updateClip(tl, "v2", { type: "video", inMs: 1000, outMs: 3000, startMs: 5000 });
    const orig = findClip(tl, "v2")!.clip;
    const moved = trimEdge(tl, orig, "start", 500, 6000);
    const v2 = findClip(moved, "v2")!.clip;
    expect([v2.startMs, v2.inMs, clipLength(v2)]).toEqual([5500, 1500, 1500]);
    // 往左拉最多到入点 0（起点 4000），且不压到前一段 v1（结束于 3000）
    const left = trimEdge(tl, orig, "start", -9999, 6000);
    const v2l = findClip(left, "v2")!.clip;
    expect([v2l.startMs, v2l.inMs]).toEqual([4000, 0]);
  });

  test("附属片段拖右边：不压到后一段", () => {
    let tl = sample();
    tl = updateClip(tl, "v1", { outMs: 3000 });
    const orig = findClip(tl, "v1")!.clip;
    const grown = trimEdge(tl, orig, "end", 9999, 100000);
    expect(lenOf(grown, "v1")).toBe(5000);
  });

  test("图片两边拖都只改时长，最长 30 秒", () => {
    let tl = sample();
    tl = updateClip(tl, "a", { type: "image", outMs: 3000 });
    const orig = findClip(tl, "a")!.clip;
    expect(lenOf(trimEdge(tl, orig, "end", 999999, 30000), "a")).toBe(30000);
    expect(lenOf(trimEdge(tl, orig, "start", 1000, 30000), "a")).toBe(2000);
  });
});

describe("移动、放置、增删", () => {
  test("附属片段能挪到同类的另一条轨，不能挪到别的类型的轨", () => {
    let tl = sample();
    const added = addTrack(tl, "audio");
    if ("error" in added) throw new Error(added.error);
    tl = added.timeline;
    const ok = moveAttached(tl, "v1", added.trackId, 7000);
    if ("error" in ok) throw new Error(ok.error);
    expect(findClip(ok.timeline, "v1")!.track.id).toBe(added.trackId);
    expect(startOf(ok.timeline, "v1")).toBe(7000);
    expect(moveAttached(tl, "v1", "overlay1", 0)).toEqual({ error: "这类片段不能放到这条轨" });
  });

  test("落在已有片段上失败；起点小于 0 收到 0", () => {
    const tl = sample();
    expect(moveAttached(tl, "v1", "voice1", 4500)).toEqual({ error: "这里已有片段，换个位置" });
    const ok = moveAttached(tl, "v1", "voice1", -300);
    if ("error" in ok) throw new Error(ok.error);
    expect(startOf(ok.timeline, "v1")).toBe(0);
  });

  test("overlapsAt 把自己排除在外", () => {
    const tl = sample();
    const voice = tl.tracks.find((t) => t.id === "voice1")!;
    expect(overlapsAt(voice, 2000, 1500)).toBe(true);
    expect(overlapsAt(voice, 3000, 2000)).toBe(false);
    expect(overlapsAt(voice, 0, 3000, "v1")).toBe(false);
  });

  test("主轨移动只调顺序，位置不变返回原对象", () => {
    const tl = sample();
    expect(moveMain(tl, "a", 0)).toBe(tl);
    expect(moveMain(tl, "a", 1)).toBe(tl);
    const moved = moveMain(tl, "a", 3);
    expect(mainTrack(moved).clips.map((c) => c.id)).toEqual(["b", "c", "a"]);
    expect(startOf(moved, "a")).toBe(6000);
  });

  test("插入主轨：按位置插入并顺延", () => {
    const tl = insertMain(sample(), 1, clip("x", { outMs: 1000 }));
    expect(mainTrack(tl).clips.map((c) => c.id)).toEqual(["a", "x", "b", "c"]);
    expect(startOf(tl, "b")).toBe(5000);
  });

  test("addAttached 校验类型匹配、重叠和锁定", () => {
    const tl = sample();
    expect(addAttached(tl, "voice1", clip("p", { type: "video", startMs: 10000 }))).toEqual({
      error: "这类片段不能放到这条轨",
    });
    expect(
      addAttached(tl, "voice1", clip("p", { type: "audio", startMs: 500, outMs: 1000 })),
    ).toEqual({
      error: "这里已有片段，换个位置",
    });
    const ok = addAttached(tl, "voice1", clip("p", { type: "audio", startMs: 3000, outMs: 1000 }));
    if ("error" in ok) throw new Error(ok.error);
    expect(findClip(ok.timeline, "p")!.track.id).toBe("voice1");
    tl.tracks.find((t) => t.id === "voice1")!.locked = true;
    expect(addAttached(tl, "voice1", clip("q", { type: "audio", startMs: 3000 }))).toEqual({
      error: "这条轨已锁定",
    });
  });

  test("删除片段：主轨后面前移，附属轨不动其他片段", () => {
    const tl = removeClip(sample(), "b");
    expect(startOf(tl, "c")).toBe(4000);
    expect(startOf(removeClip(sample(), "v1"), "v2")).toBe(5000);
    expect(removeClip(sample(), "nope")).toEqual(sample());
  });

  test("加轨有数量上限；删轨带走轨上片段；主轨不能删", () => {
    let tl = emptyTimeline();
    for (let i = 0; i < 3; i++) {
      const r = addTrack(tl, "overlay");
      if ("error" in r) throw new Error(r.error);
      tl = r.timeline;
    }
    expect(tl.tracks.filter((t) => t.kind === "overlay")).toHaveLength(4);
    expect(addTrack(tl, "overlay")).toEqual({ error: "叠加轨最多 4 条" });
    expect(addTrack(tl, "main" as never)).toEqual({ error: "不能新增这种轨道" });
    expect(removeTrack(tl, "main")).toBe(tl);
    const filled = sample();
    const removed = removeTrack(filled, "voice1");
    expect(findClip(removed, "v1")).toBeNull();
    expect(removed.tracks.some((t) => t.id === "voice1")).toBe(false);
  });

  test("新叠加轨放在最上层的叠加位置，新字幕轨放在字幕轨末尾，新音频轨放最下", () => {
    let tl = emptyTimeline();
    const o = addTrack(tl, "overlay");
    if ("error" in o) throw new Error(o.error);
    tl = o.timeline;
    expect(tl.tracks.map((t) => t.kind)).toEqual([
      "text",
      "overlay",
      "overlay",
      "main",
      "audio",
      "audio",
    ]);
    expect(tl.tracks[1].id).toBe(o.trackId);
    const t = addTrack(tl, "text");
    if ("error" in t) throw new Error(t.error);
    expect(t.timeline.tracks.map((x) => x.kind).slice(0, 2)).toEqual(["text", "text"]);
    const a = addTrack(t.timeline, "audio");
    if ("error" in a) throw new Error(a.error);
    expect(a.timeline.tracks.at(-1)!.id).toBe(a.trackId);
  });
});

describe("属性夹取", () => {
  test("音量 0–200，淡入淡出各 ≥0 且总和不超过时长", () => {
    const tl = sample();
    let next = updateClip(tl, "v1", { volume: 999 });
    expect(findClip(next, "v1")!.clip.volume).toBe(200);
    next = updateClip(tl, "v1", { fadeInMs: 2000, fadeOutMs: 2000 });
    const v1 = findClip(next, "v1")!.clip;
    expect(v1.fadeInMs + v1.fadeOutMs).toBeLessThanOrEqual(3000);
    expect(
      updateClip(tl, "v1", { fadeInMs: -5 }) &&
        findClip(updateClip(tl, "v1", { fadeInMs: -5 }), "v1")!.clip.fadeInMs,
    ).toBe(0);
  });

  test("叠加参数夹到范围内", () => {
    const tl = sample();
    const next = updateClip(tl, "o1", { overlay: { x: 150, y: -3, scale: 5, opacity: 120 } });
    expect(findClip(next, "o1")!.clip.overlay).toEqual({ x: 100, y: 0, scale: 10, opacity: 100 });
  });

  test("gainAt：淡入淡出线性，其余为 1", () => {
    const c = clip("g", { fadeInMs: 1000, fadeOutMs: 1000, outMs: 4000 });
    expect(gainAt(c, 0)).toBe(0);
    expect(gainAt(c, 500)).toBeCloseTo(0.5);
    expect(gainAt(c, 2000)).toBe(1);
    expect(gainAt(c, 3500)).toBeCloseTo(0.5);
  });
});

describe("吸附", () => {
  test("snapTime 在阈值内吸到目标，否则原样返回", () => {
    expect(snapTime(1030, [0, 1000, 5000], 50)).toEqual({ t: 1000, at: 1000 });
    expect(snapTime(1100, [0, 1000, 5000], 50)).toEqual({ t: 1100, at: null });
  });

  test("snapMove 起点和终点都参与，取更近的", () => {
    const targets = [0, 5000];
    expect(snapMove(4980, 1000, targets, 50)).toEqual({ start: 5000, at: 5000 });
    expect(snapMove(3980, 1000, targets, 50)).toEqual({ start: 4000, at: 5000 });
    expect(snapMove(2000, 500, targets, 50)).toEqual({ start: 2000, at: null });
  });
});

describe("快速添加与字幕", () => {
  test("pickAudioTrack：优先同角色且空着的轨，其次任意空轨，都满返回 null", () => {
    const tl = sample();
    expect(pickAudioTrack(tl, "voice", 3000, 1000)).toBe("voice1");
    expect(pickAudioTrack(tl, "voice", 500, 1000)).toBe("music1");
    tl.tracks.find((t) => t.id === "music1")!.clips = [
      clip("m", { type: "audio", startMs: 0, outMs: 9000 }),
    ];
    expect(pickAudioTrack(tl, "voice", 500, 1000)).toBeNull();
  });

  test("textClip 默认 2 秒、字幕样式、底部", () => {
    const c = textClip(3000, ids);
    expect([c.type, c.startMs, clipLength(c), c.text?.style, c.text?.pos, c.text?.size]).toEqual([
      "text",
      3000,
      2000,
      "subtitle",
      "bottom",
      100,
    ]);
  });
});
