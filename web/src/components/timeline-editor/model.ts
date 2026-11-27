import type {
  AudioRole,
  ClipType,
  EditError,
  EditorClip,
  EditorTimeline,
  EditorTrack,
  OverlayParams,
  TrackKind,
} from "./types";

/**
 * 多轨时间线的纯函数：所有编辑都是「旧时间线 → 新时间线」，不碰界面，也不认识任何宿主。
 * 失败时返回 {@link EditError}，文案直接给用户看。
 */

/** 每段至少 0.5 秒 */
export const MIN_CLIP_MS = 500;
/** 图片默认 3 秒 */
export const IMAGE_DEFAULT_MS = 3000;
/** 图片最长 30 秒 */
export const MAX_IMAGE_MS = 30_000;
/** 淡入或淡出最长 3 秒 */
export const MAX_FADE_MS = 3000;
/** 新字幕默认 2 秒 */
export const TEXT_DEFAULT_MS = 2000;
/** 各类附属轨最多几条 */
export const TRACK_LIMIT = { overlay: 4, text: 4, audio: 6 } as const;

/** 轨道种类的中文名，用在提示里 */
const KIND_LABEL = { overlay: "叠加轨", text: "字幕轨", audio: "音频轨" } as const;

/** 新轨道的默认名字 */
const NEW_TRACK_NAME = { overlay: "叠加", text: "字幕", audio: "音效" } as const;

/** 叠加轨片段的默认位置：铺满画面 */
export const DEFAULT_OVERLAY: OverlayParams = { x: 50, y: 50, scale: 100, opacity: 100 };

/** 生成带前缀的随机 ID */
export const newId = (prefix = "c"): string =>
  `${prefix}${Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** 把数夹到 [lo, hi] 并取整 */
const clampInt = (value: number, lo: number, hi: number): number =>
  Math.round(Math.min(hi, Math.max(lo, value)));

/** 一段的时长（毫秒） */
export const clipLength = (clip: EditorClip): number => clip.outMs - clip.inMs;

/** 一段的结束点（毫秒） */
export const clipEnd = (clip: EditorClip): number => clip.startMs + clipLength(clip);

/** 图片和文字没有素材内的位置，只有时长 */
export const isFlat = (clip: EditorClip): boolean => clip.type === "image" || clip.type === "text";

/** 一个新建的空轨道 */
const blankTrack = (
  id: string,
  kind: TrackKind,
  name: string,
  role: AudioRole | null = null,
): EditorTrack => ({
  id,
  kind,
  role,
  name,
  muted: false,
  hidden: false,
  locked: false,
  clips: [],
});

/** 没有任何内容的默认时间线：字幕 → 叠加 → 主轨 → 配音 → BGM */
export const emptyTimeline = (): EditorTimeline => ({
  tracks: [
    blankTrack("text1", "text", "字幕"),
    blankTrack("overlay1", "overlay", "叠加"),
    blankTrack("main", "main", "主轨"),
    blankTrack("voice1", "audio", "配音", "voice"),
    blankTrack("music1", "audio", "BGM", "music"),
  ],
});

/** 没有主轨时（如加载中的空时间线）返回的空主轨；只读，不会被写回时间线 */
const NO_MAIN: EditorTrack = blankTrack("main", "main", "主轨");

/** 主轨；时间线里没有主轨（如还在加载）时返回一条空主轨，调用方不用判空 */
export const mainTrack = (timeline: EditorTimeline): EditorTrack =>
  timeline.tracks.find((track) => track.kind === "main") ?? NO_MAIN;

/** 找一段和它所在的轨道、在轨内的下标；找不到为 null */
export function findClip(
  timeline: EditorTimeline,
  id: string,
): { track: EditorTrack; clip: EditorClip; index: number } | null {
  for (const track of timeline.tracks) {
    const index = track.clips.findIndex((clip) => clip.id === id);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}

/** 让主轨片段首尾相接（起点按顺序重算），附属轨按起点排序；其他字段不动 */
export function normalize(timeline: EditorTimeline): EditorTimeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) => {
      if (track.kind === "main") {
        let at = 0;
        const clips = track.clips.map((clip) => {
          const next = clip.startMs === at ? clip : { ...clip, startMs: at };
          at += clipLength(clip);
          return next;
        });
        return { ...track, clips };
      }
      const sorted = [...track.clips].sort((a, b) => a.startMs - b.startMs);
      return { ...track, clips: sorted };
    }),
  };
}

/** 整条时间线的结束点：所有轨上最晚结束的那段（毫秒） */
export const timelineEnd = (timeline: EditorTimeline): number =>
  timeline.tracks.reduce(
    (end, track) => track.clips.reduce((max, clip) => Math.max(max, clipEnd(clip)), end),
    0,
  );

/** 这种轨道能不能放这种片段 */
export function accepts(kind: TrackKind, type: ClipType): boolean {
  if (kind === "main" || kind === "overlay") return type === "video" || type === "image";
  if (kind === "audio") return type === "audio";
  return type === "text";
}

/** 轨道上 [start, start+len) 是否和别的片段重叠；exceptId 是自己，不算 */
export function overlapsAt(
  track: EditorTrack,
  start: number,
  len: number,
  exceptId?: string,
): boolean {
  return track.clips.some(
    (other) => other.id !== exceptId && start < clipEnd(other) && other.startMs < start + len,
  );
}

/** 一段左右最近的邻居边界：前一段的结束点（没有为 0）和后一段的起点（没有为 Infinity） */
export function neighborsOf(
  track: EditorTrack,
  clip: EditorClip,
): { prevEnd: number; nextStart: number } {
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    if (clipEnd(other) <= clip.startMs) prevEnd = Math.max(prevEnd, clipEnd(other));
    else if (other.startMs >= clipEnd(clip)) nextStart = Math.min(nextStart, other.startMs);
  }
  return { prevEnd, nextStart };
}

/** 夹住一段的各项参数：音量 0–200，淡入淡出不越界，叠加和文字参数在范围内 */
export function clampClip(clip: EditorClip): EditorClip {
  const len = Math.max(0, clipLength(clip));
  const fadeInMs = clampInt(clip.fadeInMs, 0, Math.min(MAX_FADE_MS, len));
  const fadeOutMs = clampInt(clip.fadeOutMs, 0, Math.min(MAX_FADE_MS, len - fadeInMs));
  return {
    ...clip,
    startMs: Math.max(0, Math.round(clip.startMs)),
    inMs: Math.round(clip.inMs),
    outMs: Math.round(clip.outMs),
    volume: clampInt(clip.volume, 0, 200),
    fadeInMs,
    fadeOutMs,
    overlay: clip.overlay && {
      x: clampInt(clip.overlay.x, 0, 100),
      y: clampInt(clip.overlay.y, 0, 100),
      scale: clampInt(clip.overlay.scale, 10, 100),
      opacity: clampInt(clip.overlay.opacity, 0, 100),
    },
    text: clip.text && { ...clip.text, size: clampInt(clip.text.size, 60, 180) },
  };
}

/** 替换整条轨道 */
const withTrack = (
  timeline: EditorTimeline,
  trackId: string,
  fn: (track: EditorTrack) => EditorTrack,
): EditorTimeline => ({
  ...timeline,
  tracks: timeline.tracks.map((track) => (track.id === trackId ? fn(track) : track)),
});

/** 改一段的属性（对象补丁或函数），夹住范围后重算主轨；找不到返回原时间线 */
export function updateClip(
  timeline: EditorTimeline,
  id: string,
  patch: Partial<EditorClip> | ((clip: EditorClip) => EditorClip),
): EditorTimeline {
  const found = findClip(timeline, id);
  if (!found) return timeline;
  const next = clampClip(
    typeof patch === "function" ? patch(found.clip) : { ...found.clip, ...patch },
  );
  return normalize(
    withTrack(timeline, found.track.id, (track) => ({
      ...track,
      clips: track.clips.map((clip) => (clip.id === id ? next : clip)),
    })),
  );
}

/** 删一段；主轨后面的前移，附属轨其他片段不动 */
export function removeClip(timeline: EditorTimeline, id: string): EditorTimeline {
  const found = findClip(timeline, id);
  if (!found) return timeline;
  return normalize(
    withTrack(timeline, found.track.id, (track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.id !== id),
    })),
  );
}

/** 在时间 t 处把一段拆成两段，两段同源；返回新时间线和后一段的 ID */
export function splitAt(
  timeline: EditorTimeline,
  id: string,
  t: number,
  makeId: () => string = newId,
): { timeline: EditorTimeline; selectId: string } | EditError {
  const found = findClip(timeline, id);
  if (!found) return { error: "找不到这一段" };
  if (found.track.locked) return { error: "这条轨已锁定" };
  const { clip } = found;
  const offset = t - clip.startMs;
  const len = clipLength(clip);
  if (offset <= 0 || offset >= len) return { error: "播放头不在这一段上" };
  if (offset < MIN_CLIP_MS || len - offset < MIN_CLIP_MS) {
    return { error: "离段边缘太近（每段至少 0.5 秒）" };
  }
  const flat = isFlat(clip);
  const first: EditorClip = { ...clip, outMs: flat ? offset : clip.inMs + offset, fadeOutMs: 0 };
  const second: EditorClip = {
    ...clip,
    id: makeId(),
    startMs: clip.startMs + offset,
    inMs: flat ? 0 : clip.inMs + offset,
    outMs: flat ? len - offset : clip.outMs,
    fadeInMs: 0,
  };
  const next = withTrack(timeline, found.track.id, (track) => {
    const clips = [...track.clips];
    clips.splice(found.index, 1, clampClip(first), clampClip(second));
    return { ...track, clips };
  });
  return { timeline: normalize(next), selectId: second.id };
}

/** 把一段播放头左边（left）或右边（right）的部分删掉；返回新时间线和播放头应该去的位置 */
export function trimToPlayhead(
  timeline: EditorTimeline,
  id: string,
  t: number,
  side: "left" | "right",
): { timeline: EditorTimeline; playhead: number } | EditError {
  const found = findClip(timeline, id);
  if (!found) return { error: "先选中一段，或把播放头放到段上" };
  if (found.track.locked) return { error: "这条轨已锁定" };
  const { clip } = found;
  const offset = t - clip.startMs;
  const len = clipLength(clip);
  if (offset <= 0 || offset >= len) return { error: "播放头要落在这一段中间" };
  const keep = side === "left" ? len - offset : offset;
  if (keep < MIN_CLIP_MS) return { error: "裁完不足 0.5 秒，请改用删除" };
  const flat = isFlat(clip);
  let next: EditorClip;
  if (side === "left") {
    next = flat
      ? { ...clip, outMs: keep, startMs: t }
      : { ...clip, inMs: clip.inMs + offset, startMs: t };
  } else {
    next = flat ? { ...clip, outMs: keep } : { ...clip, outMs: clip.inMs + offset };
  }
  // 主轨向左裁后这一段还从原来的位置开始，播放头回到段首；附属轨段首就是播放头
  const playhead = side === "left" && found.track.kind === "main" ? clip.startMs : t;
  return { timeline: updateClip(timeline, id, next), playhead };
}

/**
 * 拖一段的左边（start）或右边（end）delta 毫秒后的时间线；orig 是开始拖动时这一段的样子。
 * sourceMaxMs 是素材全长（图片是最长时长，文字传 Infinity）：入出点不超出素材，每段至少 0.5 秒；
 * 附属轨还不能压到相邻的片段；视频和音频拖左边时起点和入点一起动。
 */
export function trimEdge(
  timeline: EditorTimeline,
  orig: EditorClip,
  side: "start" | "end",
  delta: number,
  sourceMaxMs: number,
): EditorTimeline {
  const found = findClip(timeline, orig.id);
  if (!found) return timeline;
  const flat = isFlat(orig);
  const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));
  const end = clipEnd(orig);
  let next: EditorClip;
  if (found.track.kind === "main") {
    if (flat) {
      const len = side === "start" ? clipLength(orig) - delta : clipLength(orig) + delta;
      next = { ...orig, inMs: 0, outMs: clamp(len, MIN_CLIP_MS, sourceMaxMs) };
    } else if (side === "start") {
      next = { ...orig, inMs: clamp(orig.inMs + delta, 0, orig.outMs - MIN_CLIP_MS) };
    } else {
      next = { ...orig, outMs: clamp(orig.outMs + delta, orig.inMs + MIN_CLIP_MS, sourceMaxMs) };
    }
    return updateClip(timeline, orig.id, next);
  }
  const { prevEnd, nextStart } = neighborsOf(found.track, orig);
  if (side === "start") {
    const lo = flat
      ? Math.max(prevEnd, end - sourceMaxMs)
      : Math.max(prevEnd, orig.startMs - orig.inMs);
    const start = clamp(orig.startMs + delta, lo, end - MIN_CLIP_MS);
    next = flat
      ? { ...orig, startMs: start, outMs: end - start }
      : { ...orig, startMs: start, inMs: orig.inMs + (start - orig.startMs) };
  } else {
    const room = flat ? sourceMaxMs : sourceMaxMs - orig.inMs;
    const stop = clamp(
      end + delta,
      orig.startMs + MIN_CLIP_MS,
      Math.min(nextStart, orig.startMs + room),
    );
    next = flat
      ? { ...orig, outMs: stop - orig.startMs }
      : { ...orig, outMs: orig.inMs + (stop - orig.startMs) };
  }
  return updateClip(timeline, orig.id, next);
}

/** 把附属轨的一段挪到同类轨道的某个起点；起点小于 0 收到 0；落在别的片段上失败 */
export function moveAttached(
  timeline: EditorTimeline,
  id: string,
  trackId: string,
  startMs: number,
): { timeline: EditorTimeline } | EditError {
  const found = findClip(timeline, id);
  const target = timeline.tracks.find((track) => track.id === trackId);
  if (!found || !target) return { error: "找不到这一段" };
  if (found.track.kind === "main") return { error: "主轨的片段请拖动排序" };
  if (found.track.locked || target.locked) return { error: "这条轨已锁定" };
  if (target.kind !== found.track.kind || !accepts(target.kind, found.clip.type)) {
    return { error: "这类片段不能放到这条轨" };
  }
  const start = Math.max(0, Math.round(startMs));
  if (overlapsAt(target, start, clipLength(found.clip), id)) {
    return { error: "这里已有片段，换个位置" };
  }
  const moved = { ...found.clip, startMs: start };
  const without = withTrack(timeline, found.track.id, (track) => ({
    ...track,
    clips: track.clips.filter((clip) => clip.id !== id),
  }));
  return {
    timeline: normalize(
      withTrack(without, target.id, (track) => ({ ...track, clips: [...track.clips, moved] })),
    ),
  };
}

/** 把主轨第 id 段移到插入位置 toIndex（按移走之前的清单算）；位置不变返回原对象 */
export function moveMain(timeline: EditorTimeline, id: string, toIndex: number): EditorTimeline {
  const track = mainTrack(timeline);
  const from = track.clips.findIndex((clip) => clip.id === id);
  if (from < 0 || toIndex === from || toIndex === from + 1) return timeline;
  const clips = [...track.clips];
  const [clip] = clips.splice(from, 1);
  clips.splice(toIndex > from ? toIndex - 1 : toIndex, 0, clip);
  return normalize(withTrack(timeline, track.id, (t) => ({ ...t, clips })));
}

/** 在主轨第 index 个插入位置插入一段，后面的顺延 */
export function insertMain(
  timeline: EditorTimeline,
  index: number,
  clip: EditorClip,
): EditorTimeline {
  const track = mainTrack(timeline);
  const clips = [...track.clips];
  clips.splice(Math.min(Math.max(index, 0), clips.length), 0, clip);
  return normalize(withTrack(timeline, track.id, (t) => ({ ...t, clips })));
}

/** 把一段放到附属轨的 clip.startMs 处；轨道类型不符、被锁定或会压到别的片段时失败 */
export function addAttached(
  timeline: EditorTimeline,
  trackId: string,
  clip: EditorClip,
): { timeline: EditorTimeline } | EditError {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track || track.kind === "main") return { error: "这类片段不能放到这条轨" };
  if (track.locked) return { error: "这条轨已锁定" };
  if (!accepts(track.kind, clip.type)) return { error: "这类片段不能放到这条轨" };
  if (overlapsAt(track, clip.startMs, clipLength(clip))) return { error: "这里已有片段，换个位置" };
  const placed = clampClip({
    ...clip,
    overlay: track.kind === "overlay" ? (clip.overlay ?? DEFAULT_OVERLAY) : null,
  });
  return {
    timeline: normalize(
      withTrack(timeline, trackId, (t) => ({ ...t, clips: [...t.clips, placed] })),
    ),
  };
}

/** 新增一条同类轨道：叠加放在叠加轨最上面，字幕放在字幕轨末尾，音频放在最下面 */
export function addTrack(
  timeline: EditorTimeline,
  kind: TrackKind,
): { timeline: EditorTimeline; trackId: string } | EditError {
  if (kind === "main") return { error: "不能新增这种轨道" };
  const count = timeline.tracks.filter((track) => track.kind === kind).length;
  if (count >= TRACK_LIMIT[kind])
    return { error: `${KIND_LABEL[kind]}最多 ${TRACK_LIMIT[kind]} 条` };
  const track = blankTrack(
    newId("tk"),
    kind,
    NEW_TRACK_NAME[kind],
    kind === "audio" ? "sfx" : null,
  );
  const tracks = [...timeline.tracks];
  if (kind === "overlay") {
    const first = tracks.findIndex((item) => item.kind === "overlay");
    tracks.splice(first >= 0 ? first : tracks.findIndex((item) => item.kind === "main"), 0, track);
  } else if (kind === "text") {
    const last = tracks.map((item) => item.kind).lastIndexOf("text");
    tracks.splice(last + 1, 0, track);
  } else {
    tracks.push(track);
  }
  return { timeline: { ...timeline, tracks }, trackId: track.id };
}

/** 删一条轨道和它上面的片段；主轨和不存在的轨道返回原对象 */
export function removeTrack(timeline: EditorTimeline, trackId: string): EditorTimeline {
  const track = timeline.tracks.find((item) => item.id === trackId);
  if (!track || track.kind === "main") return timeline;
  return { ...timeline, tracks: timeline.tracks.filter((item) => item.id !== trackId) };
}

/** 改轨道属性（名字、静音、隐藏、锁定） */
export function updateTrack(
  timeline: EditorTimeline,
  trackId: string,
  patch: Partial<Pick<EditorTrack, "name" | "muted" | "hidden" | "locked">>,
): EditorTimeline {
  return withTrack(timeline, trackId, (track) => ({ ...track, ...patch }));
}

/** 轨道编号：主轨 V1，叠加越靠上编号越大，音频 A1 起，字幕 T1 起 */
export function trackBadge(timeline: EditorTimeline, track: EditorTrack): string {
  if (track.kind === "main") return "V1";
  const same = timeline.tracks.filter((item) => item.kind === track.kind);
  const index = same.indexOf(track);
  if (track.kind === "overlay") return `V${same.length - index + 1}`;
  return `${track.kind === "audio" ? "A" : "T"}${index + 1}`;
}

/** 给新音频选一条轨：优先同角色且这段时间空着的，其次任意空着的，都没有返回 null */
export function pickAudioTrack(
  timeline: EditorTimeline,
  role: AudioRole | null,
  startMs: number,
  len: number,
): string | null {
  const free = timeline.tracks.filter(
    (track) => track.kind === "audio" && !track.locked && !overlapsAt(track, startMs, len),
  );
  return (free.find((track) => track.role === role) ?? free[0])?.id ?? null;
}

/** 一段新字幕：默认 2 秒、字幕样式、底部 */
export const textClip = (startMs: number, makeId: () => string = newId): EditorClip => ({
  id: makeId(),
  type: "text",
  ref: null,
  startMs,
  inMs: 0,
  outMs: TEXT_DEFAULT_MS,
  muted: false,
  volume: 100,
  fadeInMs: 0,
  fadeOutMs: 0,
  overlay: null,
  text: { text: "新字幕", style: "subtitle", pos: "bottom", size: 100 },
  host: null,
});

/** 吸附目标：0、播放头、所有片段（除 exceptId）的起点和终点 */
export function snapTargets(
  timeline: EditorTimeline,
  playheadMs: number,
  exceptId?: string,
): number[] {
  const targets = [0, playheadMs];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.id === exceptId) continue;
      targets.push(clip.startMs, clipEnd(clip));
    }
  }
  return targets;
}

/** 时间 t 在阈值内就吸到最近的目标；at 是吸到的目标，没吸到为 null */
export function snapTime(
  t: number,
  targets: readonly number[],
  thresholdMs: number,
): { t: number; at: number | null } {
  let best: number | null = null;
  let bestDistance = thresholdMs;
  for (const target of targets) {
    const distance = Math.abs(target - t);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = target;
    }
  }
  return best === null ? { t, at: null } : { t: best, at: best };
}

/** 移动一段时，起点和终点都参与吸附，取离目标更近的那一个 */
export function snapMove(
  start: number,
  len: number,
  targets: readonly number[],
  thresholdMs: number,
): { start: number; at: number | null } {
  const a = snapTime(start, targets, thresholdMs);
  const b = snapTime(start + len, targets, thresholdMs);
  const da = a.at === null ? Infinity : Math.abs(a.t - start);
  const db = b.at === null ? Infinity : Math.abs(b.t - start - len);
  if (da === Infinity && db === Infinity) return { start, at: null };
  return da <= db ? { start: a.t, at: a.at } : { start: b.t - len, at: b.at };
}

/** 一段在段内 localMs 处的淡入淡出增益（0–1） */
export function gainAt(clip: EditorClip, localMs: number): number {
  const len = clipLength(clip);
  let gain = 1;
  if (clip.fadeInMs > 0 && localMs < clip.fadeInMs) gain = localMs / clip.fadeInMs;
  if (clip.fadeOutMs > 0 && len - localMs < clip.fadeOutMs) {
    gain = Math.min(gain, (len - localMs) / clip.fadeOutMs);
  }
  return Math.min(1, Math.max(0, gain));
}

/** 时间 t 落在主轨哪一段、段内偏移多少；t 在末尾或之外为 null */
export function mainClipAt(
  timeline: EditorTimeline,
  t: number,
): { clip: EditorClip; index: number; offset: number } | null {
  const clips = mainTrack(timeline).clips;
  for (let index = 0; index < clips.length; index++) {
    const offset = t - clips[index].startMs;
    if (offset >= 0 && offset < clipLength(clips[index]))
      return { clip: clips[index], index, offset };
  }
  return null;
}

/** 离时间 t 最近的主轨段边界是第几个插入位置（0 = 最前，段数 = 最后） */
export function insertIndexAt(timeline: EditorTimeline, t: number): number {
  const clips = mainTrack(timeline).clips;
  const bounds = [...clips.map((clip) => clip.startMs), clips.at(-1) ? clipEnd(clips.at(-1)!) : 0];
  let best = 0;
  bounds.forEach((bound, index) => {
    if (Math.abs(bound - t) < Math.abs(bounds[best] - t)) best = index;
  });
  return best;
}

/** 时间 t 上正在播放的附属轨片段（叠加、音频、字幕），按轨道显示顺序 */
export function attachedAt(
  timeline: EditorTimeline,
  t: number,
): { track: EditorTrack; clip: EditorClip }[] {
  const out: { track: EditorTrack; clip: EditorClip }[] = [];
  for (const track of timeline.tracks) {
    if (track.kind === "main") continue;
    for (const clip of track.clips) {
      if (t >= clip.startMs && t < clipEnd(clip)) out.push({ track, clip });
    }
  }
  return out;
}
