import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { clipEnd, clipLength, gainAt, timelineEnd } from "./model";
import { applyGain, resumeAudio } from "./audio-gain";
import {
  activeKey,
  kindOf,
  mainIndexAt,
  mainItems,
  playbackOf,
  soundOf,
  windowMedia,
  type MainItem,
  type MountedMedia,
} from "./player-plan";
import type { ClipMedia, EditorClip, EditorTimeline, PlayerHandle } from "./types";

/** 双缓冲的两个 video */
export type Slot = 0 | 1;

/** 到段尾前多少毫秒就切下一段，抵消一帧的延迟 */
const EDGE_MS = 15;
/** 叠加画面和音频在进入前后多少毫秒就挂载元素、预先定位 */
const WINDOW_MS = 1500;
/** 附属媒体和时钟的偏差超过多少毫秒才重新定位 */
const DRIFT_MS = 250;

/** 播放器给预览用的状态与元素回调 */
export interface PlayerApi {
  /** 给时间线和预览用的句柄 */
  handle: PlayerHandle;
  /** 是否在播放（驱动播放按钮） */
  playing: boolean;
  /** 主轨当前画面是第几段；没有主轨画面为 -1 */
  mainIndex: number;
  /** 正在显示画面的主轨 video 槽位 */
  activeSlot: Slot;
  /** 主轨的播放项 */
  items: readonly MainItem[];
  /** 窗口内要挂载元素的叠加画面和音频，预览负责渲染 */
  mounted: readonly MountedMedia[];
  /** 画面上的内容变化（换段、字幕出现消失）时变化的版本号，预览据此重绘 */
  version: number;
  /** 最近一次画面内容变化发生在哪个时刻（毫秒），预览用它决定此刻显示哪些字幕 */
  at: number;
  /** 主轨两个 video 的 ref 回调 */
  bindVideo: (slot: Slot) => (el: HTMLVideoElement | null) => void;
  /** 主轨图片的 ref 回调（淡变要直接改它的不透明度） */
  bindImage: (el: HTMLImageElement | null) => void;
  /** 叠加画面和音频元素挂上 / 卸下时向播放器登记（el 为 null 表示卸下） */
  register: (id: string, el: HTMLMediaElement | HTMLImageElement | null) => void;
}

/** 元素是不是 img */
const isImage = (el: Element): el is HTMLImageElement => el.tagName === "IMG";

/** 一个挂载元素的键：变了就要重新渲染（叠加位置会影响样式） */
const mountKey = (m: MountedMedia): string =>
  `${m.id}|${m.kind}|${m.url}|${m.clip.overlay?.x},${m.clip.overlay?.y},${m.clip.overlay?.scale}`;

/**
 * 多轨预览播放。
 * 主轨：两个 video 双缓冲，当前段在一个里播，下一段在另一个里预加载并定位到入点；同一视频拆开后首尾相接的两段直接接着播。
 * 附属轨：叠加视频、叠加图片和音频的片段在前后 1.5 秒窗口内挂载元素，到点定位到入点并播放；
 * 音量 = 音量百分比 × 淡入淡出，轨道和片段静音、隐藏的轨都不出声。
 * 时钟：主轨当前段是正在播放的视频时跟着视频走（视频卡住时间线也等），否则按真实时间走。
 * 注意：resolve 要在素材信息变化时才换引用（用 useCallback / useMemo），否则每次渲染都会重新定位。
 */
export function usePlayer(
  timeline: EditorTimeline,
  resolve: (clip: EditorClip) => ClipMedia,
): PlayerApi {
  const items = useMemo(() => mainItems(timeline, resolve), [timeline, resolve]);
  const total = useMemo(() => timelineEnd(timeline), [timeline]);
  const [playing, setPlaying] = useState(false);
  const [mainIndex, setMainIndex] = useState(-1);
  const [activeSlot, setActiveSlot] = useState<Slot>(0);
  const [mounted, setMounted] = useState<readonly MountedMedia[]>([]);
  const [view, setView] = useState({ version: 0, at: 0 });

  const timelineRef = useRef(timeline);
  const resolveRef = useRef(resolve);
  const itemsRef = useRef(items);
  const totalRef = useRef(total);
  const timeRef = useRef(0);
  const indexRef = useRef(-1);
  const activeRef = useRef<Slot>(0);
  const playingRef = useRef(false);
  const keyRef = useRef("");
  const mountedKeyRef = useRef("");
  const mountedRef = useRef(new Map<string, MountedMedia>());
  const videos = useRef<[HTMLVideoElement | null, HTMLVideoElement | null]>([null, null]);
  const mainImage = useRef<HTMLImageElement | null>(null);
  const elements = useRef(new Map<string, HTMLMediaElement | HTMLImageElement>());
  /** 每个槽位预备好的是哪一段（段 ID） */
  const preparedFor = useRef<[string | null, string | null]>([null, null]);
  const listeners = useRef(new Set<(ms: number) => void>());

  const notify = useCallback(() => {
    const t = timeRef.current;
    listeners.current.forEach((listener) => listener(t));
  }, []);

  /** 主轨一段的素材地址（只有视频有） */
  const videoUrl = (item: MainItem | undefined) =>
    item && kindOf(item) === "video" ? item.media.url : null;

  /** 把主轨某段装进槽位并定位到段内 offset；同一个地址不重复装，元数据没到就等它到了再定位 */
  const prepare = useCallback((slot: Slot, item: MainItem | undefined, offset: number) => {
    const video = videos.current[slot];
    if (!video) return;
    const url = videoUrl(item);
    if (!item || !url) {
      preparedFor.current[slot] = null;
      return;
    }
    preparedFor.current[slot] = item.clip.id;
    const at = (item.clip.inMs + offset) / 1000;
    if (video.dataset.src !== url) {
      video.dataset.src = url;
      video.src = url;
      video.load();
    }
    if (video.readyState >= 1) video.currentTime = at;
    else video.addEventListener("loadedmetadata", () => (video.currentTime = at), { once: true });
  }, []);

  const playVideo = useCallback((slot: Slot) => {
    void videos.current[slot]?.play().catch(() => {
      // 浏览器拦了自动播放或视频读不出来：回到暂停，用户可以再点
      playingRef.current = false;
      setPlaying(false);
    });
  }, []);

  /** 主轨当前段的音量、静音和画面淡变直接落到元素上 */
  const applyMain = useCallback((item: MainItem | undefined, t: number) => {
    const video = videos.current[activeRef.current];
    const fade = item ? gainAt(item.clip, t - item.clip.startMs) : 1;
    if (video && item && kindOf(item) === "video") {
      const sound = soundOf(item.clip, item.trackMuted, t - item.clip.startMs);
      video.muted = sound.muted;
      applyGain(video, sound.gain);
      video.style.opacity = String(fade);
    }
    if (mainImage.current) mainImage.current.style.opacity = String(fade);
  }, []);

  /** 显示主轨第 i 段的 offset 处：已在另一个槽位预备好就换过去，否则装进当前槽位；再预加载下一段 */
  const show = useCallback(
    (i: number, offset: number, autoplay: boolean) => {
      const list = itemsRef.current;
      const item = list[i];
      indexRef.current = i;
      setMainIndex(i);
      if (!item) {
        videos.current.forEach((video) => video?.pause());
        return;
      }
      let slot = activeRef.current;
      if (kindOf(item) === "video") {
        const other = (1 - slot) as Slot;
        if (preparedFor.current[other] === item.clip.id && offset === 0) slot = other;
        else prepare(slot, item, offset);
        activeRef.current = slot;
        setActiveSlot(slot);
      }
      const other = (1 - slot) as Slot;
      videos.current[other]?.pause();
      const next = list[i + 1];
      if (next && kindOf(next) === "video") prepare(other, next, 0);
      if (kindOf(item) === "video" && autoplay) playVideo(slot);
      else videos.current[slot]?.pause();
    },
    [playVideo, prepare],
  );

  /** 重新算窗口内要挂载的媒体；集合变了才更新状态，每次都刷新片段数据（音量、淡变会变） */
  const refreshMounted = useCallback((t: number) => {
    const next = windowMedia(timelineRef.current, resolveRef.current, t, WINDOW_MS);
    mountedRef.current = new Map(next.map((m) => [m.id, m]));
    const key = next.map(mountKey).join(";");
    if (key === mountedKeyRef.current) return;
    mountedKeyRef.current = key;
    setMounted(next);
  }, []);

  /** 把附属轨的媒体对齐到时间 t：到点播放、不在范围内暂停并预定位，音量、静音、画面显隐和淡变 */
  const syncAttached = useCallback((t: number, isPlaying: boolean) => {
    for (const [id, media] of mountedRef.current) {
      const el = elements.current.get(id);
      if (!el) continue;
      const pb = playbackOf(media, t);
      if (isImage(el)) {
        el.style.visibility = pb.visible ? "visible" : "hidden";
        el.style.opacity = String(pb.opacity);
        continue;
      }
      if (media.kind === "video") {
        el.style.visibility = pb.visible ? "visible" : "hidden";
        el.style.opacity = String(pb.opacity);
      }
      const drift = Math.abs(el.currentTime * 1000 - pb.sourceMs);
      if (pb.active && isPlaying) {
        if (el.paused) {
          if (drift > 80) el.currentTime = pb.sourceMs / 1000;
          void el.play().catch(() => undefined);
        } else if (drift > DRIFT_MS) el.currentTime = pb.sourceMs / 1000;
      } else {
        if (!el.paused) el.pause();
        if (drift > 80) el.currentTime = pb.sourceMs / 1000;
      }
      el.muted = pb.muted;
      applyGain(el, pb.gain);
    }
  }, []);

  /** 时间走到 t 之后统一刷新：附属媒体、预览签名、订阅者 */
  const settle = useCallback(
    (t: number, isPlaying: boolean) => {
      timeRef.current = t;
      refreshMounted(t);
      syncAttached(t, isPlaying);
      applyMain(itemsRef.current[indexRef.current], t);
      const key = `${indexRef.current}|${activeKey(timelineRef.current, t)}`;
      if (key !== keyRef.current) {
        keyRef.current = key;
        setView((v) => ({ version: v.version + 1, at: t }));
      }
      notify();
    },
    [applyMain, notify, refreshMounted, syncAttached],
  );

  const seekTo = useCallback(
    (t: number, autoplay: boolean) => {
      const clamped = Math.max(0, Math.min(t, totalRef.current));
      const i = mainIndexAt(itemsRef.current, clamped, totalRef.current);
      const item = itemsRef.current[i];
      show(
        i,
        item ? Math.min(Math.max(0, clamped - item.clip.startMs), clipLength(item.clip)) : 0,
        autoplay,
      );
      settle(clamped, autoplay);
    },
    [settle, show],
  );

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    videos.current.forEach((video) => video?.pause());
    elements.current.forEach((el) => !isImage(el) && el.pause());
  }, []);

  const toggle = useCallback(() => {
    if (playingRef.current) return pause();
    if (totalRef.current === 0) return;
    if (timeRef.current >= totalRef.current - EDGE_MS) timeRef.current = 0;
    playingRef.current = true;
    setPlaying(true);
    resumeAudio();
    seekTo(timeRef.current, true);
  }, [pause, seekTo]);

  // 时间线或素材变了（剪辑、换版本、静音、音量）：按当前时间重新定位
  useEffect(() => {
    timelineRef.current = timeline;
    resolveRef.current = resolve;
    itemsRef.current = items;
    totalRef.current = total;
    if (total === 0) {
      pause();
      timeRef.current = 0;
      indexRef.current = -1;
      setMainIndex(-1);
      settle(0, false);
      return;
    }
    seekTo(timeRef.current, playingRef.current);
  }, [timeline, resolve, items, total, pause, seekTo, settle]);

  // 播放时每帧推进时钟：主轨到段尾切下一段，附属轨跟着时钟走，到结尾停下
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const finish = () => {
      pause();
      seekTo(totalRef.current, false);
    };
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      const list = itemsRef.current;
      const i = indexRef.current;
      const item = list[i];
      const video = videos.current[activeRef.current];
      const end = item ? clipEnd(item.clip) : 0;
      const following =
        item && kindOf(item) === "video" && video && !video.paused && video.readyState >= 2;
      let t = following
        ? item.clip.startMs + (video.currentTime * 1000 - item.clip.inMs)
        : timeRef.current + dt;
      if (item && t >= end - EDGE_MS) {
        const next = list[i + 1];
        if (!next) {
          // 主轨播完了：附属轨更长就接着按真实时间走，没有主轨画面
          t = Math.max(t, end);
          if (t >= totalRef.current) return finish();
          indexRef.current = -1;
          setMainIndex(-1);
          videos.current.forEach((v) => v?.pause());
        } else {
          const contiguous =
            kindOf(item) === "video" &&
            kindOf(next) === "video" &&
            next.media.url === item.media.url &&
            next.clip.inMs === item.clip.outMs;
          if (contiguous) {
            indexRef.current = i + 1;
            setMainIndex(i + 1);
            const other = (1 - activeRef.current) as Slot;
            const after = list[i + 2];
            if (after && kindOf(after) === "video") prepare(other, after, 0);
          } else show(i + 1, 0, true);
          t = next.clip.startMs;
        }
      }
      if (t >= totalRef.current) return finish();
      settle(item && indexRef.current >= 0 ? Math.max(item.clip.startMs, t) : t, true);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause, prepare, seekTo, settle, show]);

  // 离开页面时停止，避免后台继续出声
  useEffect(() => {
    const held = videos.current;
    const attached = elements.current;
    return () => {
      held.forEach((video) => video?.pause());
      attached.forEach((el) => !isImage(el) && el.pause());
    };
  }, []);

  const handle = useMemo<PlayerHandle>(
    () => ({
      time: () => timeRef.current,
      playing: () => playingRef.current,
      duration: () => totalRef.current,
      seek: (ms) => seekTo(ms, playingRef.current),
      pause,
      toggle,
      subscribe: (listener) => {
        listeners.current.add(listener);
        return () => {
          listeners.current.delete(listener);
        };
      },
    }),
    [pause, seekTo, toggle],
  );

  const bindVideo = useCallback(
    (slot: Slot) => (el: HTMLVideoElement | null) => {
      videos.current[slot] = el;
    },
    [],
  );
  const bindImage = useCallback((el: HTMLImageElement | null) => {
    mainImage.current = el;
  }, []);
  const register = useCallback((id: string, el: HTMLMediaElement | HTMLImageElement | null) => {
    if (el) elements.current.set(id, el);
    else elements.current.delete(id);
  }, []);

  // 新挂载的元素刚进 DOM：立刻按当前时间对齐一次（定位、静音、显隐）
  useEffect(() => {
    syncAttached(timeRef.current, playingRef.current);
  }, [mounted, syncAttached]);

  return {
    handle,
    playing,
    mainIndex,
    activeSlot,
    items,
    mounted,
    version: view.version,
    at: view.at,
    bindVideo,
    bindImage,
    register,
  };
}
