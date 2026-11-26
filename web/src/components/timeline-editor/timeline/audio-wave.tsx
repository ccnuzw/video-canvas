import { useMemo } from "react";

import { clipLength, gainAt } from "../model";
import type { EditorClip } from "../types";
import { useWaveform } from "./use-waveform";
import { PEAKS_PER_SEC, pseudoPeaks, windowPeaks } from "./waveform";

/** 一根竖条占的宽度（像素） */
const BAR_STEP = 3;
/** 一个片段最多画多少根竖条 */
const MAX_BARS = 800;

/**
 * 音频片段上的波形：优先用解码出来的真实波形，读不到时用按片段 ID 生成的固定伪波形；
 * 高度随音量和淡入淡出变化。
 */
export function AudioWave({
  clip,
  url,
  width,
  height,
}: {
  /** 片段 */
  clip: EditorClip;
  /** 音频地址；没有为 null，直接用伪波形 */
  url: string | null;
  /** 片段宽度（像素） */
  width: number;
  /** 画布高度（像素） */
  height: number;
}) {
  const real = useWaveform(url);
  const path = useMemo(() => {
    const bars = Math.max(1, Math.min(MAX_BARS, Math.floor(width / BAR_STEP)));
    const peaks = real
      ? windowPeaks(real, PEAKS_PER_SEC, clip.inMs, clip.outMs, bars)
      : pseudoPeaks(clip.id, bars);
    const volume = Math.min(1.2, clip.volume / 100);
    const len = clipLength(clip);
    return peaks
      .map((peak, i) => {
        const amp = peak * (height / 2 - 3) * volume * gainAt(clip, (i / bars) * len);
        const x = ((i + 0.5) / bars) * width;
        return `M${x.toFixed(1)} ${(height / 2 - amp).toFixed(1)}V${(height / 2 + amp).toFixed(1)}`;
      })
      .join("");
  }, [real, clip, width, height]);
  return (
    <svg className="absolute inset-0" width={width} height={height} aria-hidden>
      <path d={path} strokeWidth={2} className="stroke-white/55" />
    </svg>
  );
}
