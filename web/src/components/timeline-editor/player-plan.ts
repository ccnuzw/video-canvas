import { clipEnd, clipLength, gainAt, mainTrack } from "./model";
import type { ClipMedia, EditorClip, EditorTimeline, TrackKind } from "./types";

/**
 * 播放器的纯逻辑：给定时间线和时间点，算出每条轨此刻该显示什么、该播什么、音量多少。
 * 不碰 DOM，播放器 hook 只负责把结果落到元素上。
 */

/** 主轨上的一段，加上解析出来的素材和静音状态 */
export interface MainItem {
  /** 这一段 */
  clip: EditorClip;
  /** 宿主解析出的素材 */
  media: ClipMedia;
  /** 主轨整轨静音 */
  trackMuted: boolean;
  /** 这一段播放时静音（轨静音、段静音或音量为 0） */
  muted: boolean;
}

/** 主轨一段的画面种类：视频、图片、占位或失效 */
export type MainKind = "video" | "image" | "placeholder" | "broken";

/** 一段声音：是否静音和增益（1 = 原音量，最大 2） */
export interface Sound {
  /** 是否静音 */
  muted: boolean;
  /** 增益：音量百分比 × 淡入淡出 */
  gain: number;
}

/** 窗口内要挂载的一个叠加画面或音频 */
export interface MountedMedia {
  /** 片段 ID，也是元素的键 */
  id: string;
  /** 元素种类：叠加视频、叠加图片、音频 */
  kind: "video" | "image" | "audio";
  /** 素材地址 */
  url: string;
  /** 所在轨道 ID */
  trackId: string;
  /** 所在轨道种类 */
  trackKind: TrackKind;
  /** 所在轨道静音 */
  trackMuted: boolean;
  /** 所在轨道隐藏 */
  hidden: boolean;
  /** 片段本身 */
  clip: EditorClip;
}

/** 一个挂载的媒体在某一时刻的播放状态 */
export interface AttachedPlayback {
  /** 此刻是否在这一段的时间范围内 */
  active: boolean;
  /** 此刻对应素材内的位置（毫秒）；没到时是入点，过了是出点 */
  sourceMs: number;
  /** 是否静音 */
  muted: boolean;
  /** 增益 */
  gain: number;
  /** 不透明度（0–1），叠加画面用 */
  opacity: number;
  /** 画面是否可见（音频恒为 false） */
  visible: boolean;
}

/** 主轨一段的画面种类 */
export function kindOf(item: MainItem): MainKind {
  if (item.media.state === "placeholder") return "placeholder";
  if (item.media.state === "broken" || !item.media.url) return "broken";
  return item.clip.type === "image" ? "image" : "video";
}

/** 一段声音：轨道静音、段静音、音量为 0 都算静音；增益 = 音量百分比 × 淡入淡出 */
export function soundOf(clip: EditorClip, trackMuted: boolean, offsetMs: number): Sound {
  return {
    muted: trackMuted || clip.muted || clip.volume === 0,
    gain: (clip.volume / 100) * gainAt(clip, offsetMs),
  };
}

/** 主轨的播放项 */
export function mainItems(
  timeline: EditorTimeline,
  resolve: (clip: EditorClip) => ClipMedia,
): MainItem[] {
  const track = mainTrack(timeline);
  return track.clips.map((clip) => ({
    clip,
    media: resolve(clip),
    trackMuted: track.muted,
    muted: track.muted || clip.muted || clip.volume === 0,
  }));
}

/**
 * 时间 t 落在主轨第几段。
 * t 在主轨之外：主轨正好是最后结束的就停在最后一段（显示最后一帧），否则没有主轨画面（-1）。
 */
export function mainIndexAt(items: readonly MainItem[], t: number, total: number): number {
  if (items.length === 0) return -1;
  const at = items.findIndex((item) => t >= item.clip.startMs && t < clipEnd(item.clip));
  if (at >= 0) return at;
  return clipEnd(items[items.length - 1].clip) >= total ? items.length - 1 : -1;
}

/** 可挂载的媒体种类；文字、失效和占位没有元素 */
function mountKind(track: TrackKind, clip: EditorClip): MountedMedia["kind"] | null {
  if (track === "audio") return clip.type === "audio" ? "audio" : null;
  if (track === "overlay") {
    if (clip.type === "video") return "video";
    return clip.type === "image" ? "image" : null;
  }
  return null;
}

/**
 * 时间 t 前后 windowMs 内要挂载的叠加画面和音频：叠加轨从下往上排（上层在后，才盖得住下层），再接音频轨。
 * 只含素材可用的片段。
 */
export function windowMedia(
  timeline: EditorTimeline,
  resolve: (clip: EditorClip) => ClipMedia,
  t: number,
  windowMs: number,
): MountedMedia[] {
  const out: MountedMedia[] = [];
  const near = (clip: EditorClip) => t >= clip.startMs - windowMs && t < clipEnd(clip) + windowMs;
  const add = (kinds: TrackKind) => {
    const tracks = timeline.tracks.filter((track) => track.kind === kinds);
    for (const track of kinds === "overlay" ? [...tracks].reverse() : tracks) {
      for (const clip of track.clips) {
        const kind = mountKind(track.kind, clip);
        if (!kind || !near(clip)) continue;
        const media = resolve(clip);
        if (media.state !== "ready" || !media.url) continue;
        out.push({
          id: clip.id,
          kind,
          url: media.url,
          trackId: track.id,
          trackKind: track.kind,
          trackMuted: track.muted,
          hidden: track.hidden,
          clip,
        });
      }
    }
  };
  add("overlay");
  add("audio");
  return out;
}

/** 一个挂载的媒体在时间 t 的播放状态 */
export function playbackOf(media: MountedMedia, t: number): AttachedPlayback {
  const { clip } = media;
  const offset = t - clip.startMs;
  const active = offset >= 0 && offset < clipLength(clip);
  const sound = soundOf(clip, media.trackMuted, offset);
  const base = t < clip.startMs ? clip.inMs : clip.outMs;
  const visible = active && !media.hidden && media.kind !== "audio";
  return {
    active,
    sourceMs: active ? clip.inMs + offset : base,
    muted: sound.muted || media.hidden,
    gain: sound.gain,
    opacity: ((clip.overlay?.opacity ?? 100) / 100) * gainAt(clip, offset),
    visible,
  };
}

/** 时间 t 此刻在显示的字幕和标题（轨道没隐藏的） */
export function activeTexts(timeline: EditorTimeline, t: number): EditorClip[] {
  const out: EditorClip[] = [];
  for (const track of timeline.tracks) {
    if (track.kind !== "text" || track.hidden) continue;
    for (const clip of track.clips) {
      if (t >= clip.startMs && t < clipEnd(clip)) out.push(clip);
    }
  }
  return out;
}

/** 此刻「画面上有什么」的签名：变了预览就要重绘（主轨第几段、在显示的叠加和文字） */
export function activeKey(timeline: EditorTimeline, t: number): string {
  const ids: string[] = [];
  for (const track of timeline.tracks) {
    if (track.kind === "audio") continue;
    for (const clip of track.clips) {
      if (t >= clip.startMs && t < clipEnd(clip)) ids.push(clip.id);
    }
  }
  return ids.join(",");
}
