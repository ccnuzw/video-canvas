import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { PlayerHandle } from "../types";
import { HEAD_WIDTH, anchoredScroll, clampPps, fitPps, laneWidth, msToX, xToMs } from "./layout";

/**
 * 时间线的视图状态：缩放（含适配宽度）、可见宽度、播放头位置、指针位置换算。
 * 播放头每帧变化，不放进 React 状态，直接改 DOM。
 */
export function useTimelineView(
  scrollRef: RefObject<HTMLDivElement | null>,
  playheadRef: RefObject<HTMLDivElement | null>,
  knobRef: RefObject<HTMLDivElement | null>,
  player: PlayerHandle,
  totalMs: number,
) {
  const [manualPps, setManualPps] = useState<number | null>(null);
  /** 轨道内容的可见宽度（像素），不含左侧轨道头 */
  const [viewport, setViewport] = useState(900);

  const minPps = fitPps(viewport, totalMs);
  const pps = clampPps(manualPps ?? minPps, minPps);
  const ppsRef = useRef(pps);
  useLayoutEffect(() => {
    ppsRef.current = pps;
  }, [pps]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewport(Math.max(0, el.clientWidth - HEAD_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  // 播放头：订阅播放器时钟直接改位置；播放时滚动跟随；被轨道头盖住时隐藏
  useEffect(() => {
    const update = () => {
      const el = scrollRef.current;
      const x = msToX(player.time(), pps);
      const hidden = !!el && HEAD_WIDTH + x < el.scrollLeft + HEAD_WIDTH;
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${HEAD_WIDTH + x}px)`;
        playheadRef.current.style.visibility = hidden ? "hidden" : "visible";
      }
      if (knobRef.current) {
        knobRef.current.style.transform = `translateX(${x}px)`;
        knobRef.current.style.visibility = hidden ? "hidden" : "visible";
      }
      if (
        el &&
        player.playing() &&
        (x > el.scrollLeft + el.clientWidth - HEAD_WIDTH - 40 || hidden)
      ) {
        el.scrollLeft = Math.max(0, x - 80);
      }
    };
    update();
    const el = scrollRef.current;
    el?.addEventListener("scroll", update, { passive: true });
    const off = player.subscribe(update);
    return () => {
      el?.removeEventListener("scroll", update);
      off();
    };
  }, [player, pps, scrollRef, playheadRef, knobRef]);

  /** 缩放时以播放头为锚：记下它在可见区域里的位置，缩放后滚到让它停在原处，画面不跳 */
  const anchor = useRef<{ t: number; x: number } | null>(null);
  const fitNow = useCallback(() => {
    anchor.current = null;
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
    setManualPps(null);
  }, [scrollRef]);
  const zoomTo = useCallback(
    (next: number) => {
      const target = clampPps(next, minPps);
      if (target === ppsRef.current) return;
      if (target === minPps) return fitNow();
      const el = scrollRef.current;
      const t = player.time();
      if (el) anchor.current = { t, x: msToX(t, ppsRef.current) - el.scrollLeft };
      setManualPps(target);
    },
    [fitNow, minPps, player, scrollRef],
  );
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const at = anchor.current;
    anchor.current = null;
    if (el && at) el.scrollLeft = anchoredScroll(at.t, at.x, pps);
  }, [pps, scrollRef]);

  // ⌘ / Ctrl + 滚轮缩放；要 preventDefault，所以用非被动的原生监听
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      event.preventDefault();
      zoomTo(ppsRef.current * (event.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo, scrollRef]);

  /** 第一条轨道内容区的左边缘（像素，视口坐标）；所有轨对齐，随便取一条 */
  const laneLeft = useCallback(
    () =>
      scrollRef.current?.querySelector<HTMLElement>("[data-lane]")?.getBoundingClientRect().left ??
      0,
    [scrollRef],
  );

  /** 指针位置对应的时间线毫秒 */
  const timeAt = useCallback(
    (clientX: number) => xToMs(clientX - laneLeft(), ppsRef.current),
    [laneLeft],
  );

  /** 指针纵坐标落在哪条轨道上；不在任何轨道上为 null */
  const laneAt = useCallback(
    (clientY: number): string | null => {
      const lanes = scrollRef.current?.querySelectorAll<HTMLElement>("[data-lane]") ?? [];
      for (const lane of lanes) {
        const rect = lane.getBoundingClientRect();
        if (clientY >= rect.top && clientY < rect.bottom) return lane.dataset.lane ?? null;
      }
      return null;
    },
    [scrollRef],
  );

  return {
    pps,
    minPps,
    width: laneWidth(totalMs, pps, viewport),
    zoomTo,
    fitNow,
    timeAt,
    laneAt,
  };
}
