import { emptyTimeline, normalize } from "@/components/timeline-editor/model";
import type {
  ClipMedia,
  EditorClip,
  EditorTimeline,
  MediaItem,
  MediaTab,
  TimelineEditorHost,
} from "@/components/timeline-editor/types";

/** 测试用片段 */
export const clip = (id: string, over: Partial<EditorClip> = {}): EditorClip => ({
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
export const resolve = (c: EditorClip): ClipMedia => {
  const ref = c.ref ?? "";
  const state = ref.startsWith("ph") ? "placeholder" : ref.startsWith("bad") ? "broken" : "ready";
  return {
    state,
    url: state === "ready" ? `https://x/${ref}.mp4` : null,
    durationMs: 9000,
    label: `素材 ${ref}`,
    thumbUrl: null,
  };
};

/** 主轨 a、b；叠加 o1；配音 v1；字幕 s1 */
export function sampleTimeline(): EditorTimeline {
  const tl = emptyTimeline();
  const by = (id: string) => tl.tracks.find((t) => t.id === id)!;
  by("main").clips = [clip("a"), clip("b")];
  by("overlay1").clips = [
    clip("o1", { startMs: 1000, outMs: 2000, overlay: { x: 30, y: 40, scale: 50, opacity: 80 } }),
  ];
  by("voice1").clips = [clip("v1", { type: "audio", startMs: 2000, outMs: 3000 })];
  by("text1").clips = [
    clip("s1", {
      type: "text",
      ref: null,
      outMs: 2000,
      text: { text: "你好世界", style: "subtitle", pos: "bottom", size: 100 },
    }),
  ];
  return normalize(tl);
}

/** 测试用素材卡 */
export const item = (id: string, over: Partial<MediaItem> = {}): MediaItem => ({
  id,
  type: "video",
  title: `卡片 ${id}`,
  subtitle: "视频 · 6s",
  thumbUrl: null,
  aspect: "project",
  badge: null,
  onTimeline: false,
  status: "ready",
  progress: 0,
  payload: { id },
  ...over,
});

/** 一个标签两组卡片 */
export const tab = (over: Partial<MediaTab> = {}): MediaTab => ({
  id: "t1",
  label: "片段",
  sections: [
    {
      title: "片段 01 · 15s",
      items: [item("a", { badge: "已采用" }), item("b", { onTimeline: true })],
    },
    { title: null, items: [item("c", { type: "image", subtitle: "图片" })] },
  ],
  loading: false,
  emptyText: "这里还没有素材",
  filterable: true,
  importable: true,
  ...over,
});

/** 测试用宿主 */
export const host = (over: Partial<TimelineEditorHost> = {}): TimelineEditorHost => ({
  resolve,
  tabs: [tab()],
  createClip: async () => null,
  ...over,
});
