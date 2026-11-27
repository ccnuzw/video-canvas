import { useEffect, useState } from "react";

import { loadPeaks } from "./waveform";

/**
 * 读取并解码一段音频的真实波形峰值（带缓存）。
 * 还没读完或读不了时返回 null，调用方用伪波形兜底。
 */
export function useWaveform(url: string | null): number[] | null {
  const [loaded, setLoaded] = useState<{ url: string; peaks: number[] | null } | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    void loadPeaks(url).then((peaks) => {
      if (alive) setLoaded({ url, peaks });
    });
    return () => {
      alive = false;
    };
  }, [url]);
  return loaded && loaded.url === url ? loaded.peaks : null;
}
