import { useEffect, useState, type RefObject } from "react";

import { getUnit } from "@/api/drama";
import type { DramaUnit } from "@/api/drama/type";
import { Skeleton } from "@/components/ui/skeleton";

/** 一次最多读多少个原文单元：一集对应的原文通常是几章，极端情况只读前面这些 */
const MAX_UNITS = 30;

/**
 * 原著对照：只读显示这一集对应的原文（逐个单元读取）。滚动跟着稿纸走（见 useSourceSync），不做段落联动。
 * @param dramaId 短剧 id
 * @param from 起始单元号
 * @param to 结束单元号
 * @param paneRef 这一栏自己，供滚动同步读写 scrollTop
 * @param onLoaded 原文读完（内容高度有了）时调用，用来对齐一次滚动位置
 */
export function SourcePane({
  dramaId,
  from,
  to,
  paneRef,
  onLoaded,
}: {
  dramaId: string;
  from: number;
  to: number;
  paneRef?: RefObject<HTMLElement | null>;
  onLoaded?: () => void;
}) {
  const [units, setUnits] = useState<DramaUnit[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const nos = Array.from({ length: Math.min(to - from + 1, MAX_UNITS) }, (_, i) => from + i);
    Promise.all(nos.map((no) => getUnit(dramaId, no)))
      .then((rows) => active && setUnits(rows))
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
    };
  }, [dramaId, from, to]);

  // 原文画出来之后高度才是对的，等一帧再通知
  useEffect(() => {
    if (!units) return;
    const frame = requestAnimationFrame(() => onLoaded?.());
    return () => cancelAnimationFrame(frame);
  }, [units, onLoaded]);

  return (
    <aside
      ref={paneRef}
      aria-label="原著对照"
      className="bg-card ring-border sticky top-6 max-h-[calc(100svh-7rem)] min-w-0 self-start overflow-y-auto rounded-2xl px-6 py-5 ring-1"
    >
      {failed ? (
        <p className="text-muted-foreground py-8 text-center text-sm">原文读取失败，请稍后重试</p>
      ) : !units ? (
        <div className="grid gap-2.5">
          {[90, 70, 80].map((width) => (
            <Skeleton
              key={width}
              className="h-4 motion-reduce:animate-none"
              style={{ width: `${width}%` }}
            />
          ))}
        </div>
      ) : (
        units.map((unit) => (
          <section key={unit.no} className="mb-6 last:mb-0">
            <h3 className="font-display mb-2 text-[15px] font-bold">{unit.title}</h3>
            {(unit.text ?? "")
              .split(/\n+/)
              .filter(Boolean)
              .map((line, i) => (
                <p key={i} className="text-muted-foreground mb-2.5 indent-8 text-sm leading-[1.95]">
                  {line}
                </p>
              ))}
          </section>
        ))
      )}
    </aside>
  );
}
