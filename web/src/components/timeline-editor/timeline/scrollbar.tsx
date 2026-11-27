import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
} from "react";

import { cn } from "@/lib/utils";

/**
 * 时间线自绘的细滚动条。
 * 原生滚动条在 macOS 上是浮层，程序改滚动位置（如以播放头为锚缩放）时会一闪一闪；
 * 自绘的一直显示，只在轨道内容区里，缩放时只有滑块长短变化。
 */

/** 滑块最短多少像素，内容很长时也好抓 */
const MIN_THUMB = 24;

/** 一个方向上的滚动尺寸（像素） */
interface ScrollGeometry {
  /** 可见区域长度 */
  viewport: number;
  /** 内容总长度 */
  content: number;
  /** 滚动条轨道长度 */
  track: number;
}

/** 滑块的长度和它在轨道里的起点（像素） */
export interface Thumb {
  /** 滑块长度 */
  size: number;
  /** 滑块起点 */
  offset: number;
}

/**
 * 算滑块：长度按可见比例（不小于最短长度），位置按滚动比例，越界的滚动位置夹到轨道内
 * @param geo 当前滚动位置和尺寸
 * @returns 滑块；内容没超出可见区域时为 null
 */
export function thumbOf(geo: ScrollGeometry & { scroll: number }): Thumb | null {
  const room = geo.content - geo.viewport;
  if (room <= 0 || geo.track <= 0) return null;
  const size = Math.min(geo.track, Math.max(MIN_THUMB, (geo.viewport / geo.content) * geo.track));
  const ratio = Math.min(1, Math.max(0, geo.scroll / room));
  return { size: Math.round(size), offset: Math.round(ratio * (geo.track - size)) };
}

/**
 * 滑块起点换算回滚动位置，夹在可滚范围内
 * @param offset 滑块起点（像素）
 * @param geo 尺寸
 * @returns 滚动位置（像素）
 */
export function scrollFromThumb(offset: number, geo: ScrollGeometry): number {
  const room = geo.content - geo.viewport;
  const thumb = thumbOf({ ...geo, scroll: 0 });
  if (!thumb || room <= 0) return 0;
  const free = geo.track - thumb.size;
  const ratio = free > 0 ? Math.min(1, Math.max(0, offset / free)) : 0;
  return Math.round(ratio * room);
}

/** 从滚动容器读一个方向的尺寸 */
function geometryOf(el: HTMLElement, axis: "x" | "y", track: number) {
  return axis === "x"
    ? { scroll: el.scrollLeft, viewport: el.clientWidth, content: el.scrollWidth, track }
    : { scroll: el.scrollTop, viewport: el.clientHeight, content: el.scrollHeight, track };
}

/**
 * 一条自绘滚动条：跟着容器滚动和尺寸变化更新；拖滑块滚动，点轨道空白处跳到那里。
 * 位置由父元素用 className 摆放（父元素要 relative）；内容没超出时轨道留着、滑块不显示。
 */
export function TimelineScrollbar({
  scrollRef,
  axis,
  className,
  style,
}: {
  /** 被控制的滚动容器 */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** 横向或竖向 */
  axis: "x" | "y";
  /** 摆放位置和尺寸 */
  className?: string;
  /** 摆放位置（需要按常量算的偏移） */
  style?: CSSProperties;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb | null>(null);
  const grab = useRef<{ start: number; offset: number } | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const update = () => {
      const length = axis === "x" ? track.clientWidth : track.clientHeight;
      const next = thumbOf(geometryOf(el, axis, length));
      setThumb((prev) =>
        prev?.size === next?.size && prev?.offset === next?.offset ? prev : next,
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // 内容宽度随缩放变化、容器随分栏拖动变化，都要重算
    const observer = new ResizeObserver(update);
    observer.observe(el);
    observer.observe(track);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [scrollRef, axis]);

  const lengthOfTrack = () => {
    const track = trackRef.current;
    return track ? (axis === "x" ? track.clientWidth : track.clientHeight) : 0;
  };
  const scrollTo = (offset: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const pos = scrollFromThumb(offset, geometryOf(el, axis, lengthOfTrack()));
    if (axis === "x") el.scrollLeft = pos;
    else el.scrollTop = pos;
  };
  const coord = (event: PointerEvent) => (axis === "x" ? event.clientX : event.clientY);

  const onTrackDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !thumb || !trackRef.current) return;
    event.preventDefault();
    const rect = trackRef.current.getBoundingClientRect();
    const at = coord(event) - (axis === "x" ? rect.left : rect.top);
    const onThumb = at >= thumb.offset && at <= thumb.offset + thumb.size;
    // 点空白处：滑块中心跳到点的位置，接着可以直接拖
    const offset = onThumb ? thumb.offset : at - thumb.size / 2;
    if (!onThumb) scrollTo(offset);
    grab.current = { start: coord(event), offset };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!grab.current) return;
    scrollTo(grab.current.offset + coord(event) - grab.current.start);
  };
  const onUp = () => {
    grab.current = null;
  };

  return (
    <div
      ref={trackRef}
      aria-hidden
      onPointerDown={onTrackDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={style}
      className={cn("absolute z-50 rounded-full", className)}
    >
      {thumb && (
        <div
          style={
            axis === "x"
              ? { width: thumb.size, transform: `translateX(${thumb.offset}px)` }
              : { height: thumb.size, transform: `translateY(${thumb.offset}px)` }
          }
          className={cn(
            "bg-foreground/25 hover:bg-foreground/40 rounded-full transition-colors",
            axis === "x" ? "h-full" : "w-full",
          )}
        />
      )}
    </div>
  );
}
