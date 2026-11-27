import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyTimeline, normalize, textClip } from "@/components/timeline-editor/model";
import { TimelinePanel } from "@/components/timeline-editor/timeline";
import type {
  ClipMedia,
  EditorClip,
  EditorTimeline,
  PlayerHandle,
  TimelineEditorHost,
  TimelinePanelProps,
} from "@/components/timeline-editor/types";

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

/** 主轨三段（正常、待采用占位、失效）+ 叠加一段 + 配音一段（带淡入）+ 字幕一条 */
function sample(): EditorTimeline {
  const tl = emptyTimeline();
  const by = (id: string) => tl.tracks.find((t) => t.id === id)!;
  by("main").clips = [clip("a"), clip("ph"), clip("bad")];
  by("overlay1").clips = [
    clip("o1", { startMs: 1000, outMs: 2000, overlay: { x: 50, y: 50, scale: 100, opacity: 100 } }),
  ];
  by("voice1").clips = [clip("v1", { type: "audio", startMs: 0, outMs: 3000, fadeInMs: 800 })];
  by("text1").clips = [
    {
      ...textClip(500),
      id: "t1",
      text: { text: "你好世界", style: "subtitle", pos: "bottom", size: 100 },
    },
  ];
  return normalize(tl);
}

const media = (state: ClipMedia["state"], label: string): ClipMedia => ({
  state,
  url: state === "ready" ? "https://example.com/x" : null,
  durationMs: 9000,
  label,
  thumbUrl: null,
});

const host = (over: Partial<TimelineEditorHost> = {}): TimelineEditorHost => ({
  resolve: (c) =>
    c.id === "ph"
      ? media("placeholder", "片段 02")
      : c.id === "bad"
        ? media("broken", "片段 03")
        : media("ready", c.type === "audio" ? "配音.mp3" : `名字-${c.id}`),
  tabs: [],
  createClip: async () => null,
  ...over,
});

const player: PlayerHandle = {
  time: () => 0,
  playing: () => false,
  duration: () => 12000,
  seek: () => {},
  pause: () => {},
  toggle: () => {},
  subscribe: () => () => {},
};

const noop = () => {};

const render = (timeline: EditorTimeline, over: Partial<TimelinePanelProps> = {}) =>
  renderToStaticMarkup(
    <TimelinePanel
      timeline={timeline}
      host={host()}
      selectedIds={[]}
      onSelect={noop}
      player={player}
      readOnly={false}
      canUndo
      canRedo={false}
      onChange={noop}
      onUndo={noop}
      onRedo={noop}
      onDropMedia={noop}
      onError={noop}
      {...over}
    />,
  );

/** 按 aria-label 找按钮，返回它是否带 disabled 属性（class 里的 disabled: 前缀不算） */
const disabled = (html: string, label: string) => {
  const tag = html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0];
  if (!tag) throw new Error(`找不到按钮：${label}`);
  return /\sdisabled(=|\s|>)/.test(tag);
};

describe("时间线面板渲染", () => {
  test("默认适配整条时间线，缩小按钮到达下限", () => {
    const html = render(sample());
    expect(disabled(html, "缩小")).toBe(true);
    expect(disabled(html, "放大")).toBe(false);
  });

  test("每条轨有轨道头和编号，片段显示名字、时长和文字内容", () => {
    const html = render(sample());
    for (const badge of ["T1", "V2", "V1", "A1", "A2"]) expect(html).toContain(`>${badge}<`);
    for (const name of ["字幕", "叠加", "主轨", "配音", "BGM"]) expect(html).toContain(`>${name}`);
    expect(html).toContain("名字-a");
    expect(html).toContain("4.0s");
    expect(html).toContain("你好世界");
    expect(html).toContain("配音.mp3");
    expect(html).toContain('data-lane="main"');
    expect(html).toContain('data-clip="v1"');
  });

  test("占位是斜纹，失效是红描边，淡入有遮罩", () => {
    const html = render(sample());
    expect(html).toContain("repeating-linear-gradient(135deg,var(--color-muted)");
    expect(html).toContain("border-destructive");
    expect(html).toContain("polygon(0_0,100%_0,0_100%)");
  });

  test("选中的片段是主色描边，宿主标记显示图钉和蓝点", () => {
    const html = render(sample(), {
      selectedIds: ["a"],
      host: host({
        clipBadges: (c) => ({ pinned: c.id === "a", marked: c.id === "o1" }),
      }),
    });
    expect(html).toContain("border-primary");
    expect(html).toContain("lucide-pin");
    expect(html).toContain("bg-sky-400");
  });

  test("只有宿主提供了按台词生成，空字幕轨才出现入口", () => {
    const empty = emptyTimeline();
    expect(render(empty)).not.toContain("按台词生成");
    expect(render(empty, { host: host({ generateSubtitles: () => [] }) })).toContain("按台词生成");
  });
});

describe("锁定、隐藏与只读", () => {
  test("锁定的轨：轨道头显示「解锁」，轨上片段没有裁剪手柄", () => {
    const tl = sample();
    tl.tracks.find((t) => t.id === "voice1")!.locked = true;
    const html = render(tl);
    expect(html).toContain('aria-label="解锁"');
    const lane = html.split('data-lane="voice1"')[1].split('data-lane="music1"')[0];
    expect(lane).not.toContain("cursor-ew-resize");
    expect(lane).toContain("repeating-linear-gradient(135deg,transparent_0_6px");
  });

  test("隐藏的叠加轨和静音的音频轨上的片段变淡", () => {
    const tl = sample();
    tl.tracks.find((t) => t.id === "overlay1")!.hidden = true;
    expect(render(tl)).toContain("opacity-35");
    const muted = sample();
    muted.tracks.find((t) => t.id === "voice1")!.muted = true;
    expect(render(muted)).toContain("opacity-35");
    expect(render(sample())).not.toContain("opacity-35");
  });

  test("只读：编辑入口全部禁用，裁剪和淡变手柄不渲染，但缩放仍可用", () => {
    const html = render(sample(), { readOnly: true });
    for (const label of ["撤销", "拆分", "删掉播放头左边", "删掉播放头右边", "删除", "新增轨道"]) {
      expect(disabled(html, label)).toBe(true);
    }
    expect(disabled(html, "放大")).toBe(false);
    expect(disabled(html, "适配宽度")).toBe(false);
    expect(html).not.toContain("cursor-ew-resize");
  });

  test("可编辑时：有裁剪手柄；没选中时删除不可用，选中后可用", () => {
    expect(render(sample())).toContain("cursor-ew-resize");
    expect(disabled(render(sample()), "删除")).toBe(true);
    expect(disabled(render(sample(), { selectedIds: ["a"] }), "删除")).toBe(false);
    expect(disabled(render(sample(), { canUndo: false }), "撤销")).toBe(true);
  });

  test("多选时所有片段高亮，删除可用，单段裁剪与拆分禁用", () => {
    const html = render(sample(), { selectedIds: ["a", "o1"] });
    for (const id of ["a", "o1"]) {
      expect(html.match(new RegExp(`<div data-clip="${id}"[^>]*>`))?.[0]).toContain(
        "before:border-primary",
      );
    }
    expect(disabled(html, "删除")).toBe(false);
    for (const label of ["拆分", "删掉播放头左边", "删掉播放头右边"]) {
      expect(disabled(html, label)).toBe(true);
    }
  });
});
