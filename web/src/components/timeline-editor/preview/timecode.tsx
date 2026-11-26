import { useCallback, useSyncExternalStore } from "react";

import type { PlayerHandle } from "../types";

/** 毫秒写成 00:00.00（最后两位是帧，按 30fps） */
export const timecode = (ms: number): string => {
  const s = Math.max(0, ms) / 1000;
  const pad = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${pad(s / 60)}:${pad(s % 60)}.${pad((s % 1) * 30)}`;
};

/** 当前时间码：订阅播放器时钟，只有显示的帧变了才重渲染 */
export function Timecode({ player }: { player: PlayerHandle }) {
  const subscribe = useCallback(
    (onChange: () => void) => player.subscribe(() => onChange()),
    [player],
  );
  const frame = useSyncExternalStore(
    subscribe,
    () => Math.floor(player.time() / 33),
    () => 0,
  );
  return <span className="font-mono text-[12.5px] tabular-nums">{timecode(frame * 33)}</span>;
}
