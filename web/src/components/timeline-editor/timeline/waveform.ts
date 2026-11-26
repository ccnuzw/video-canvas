/**
 * 音频波形的峰值计算：真实波形（解码素材取峰值，带缓存）和兜底的伪波形。
 */

/** 真实峰值的分辨率：每秒多少个峰值 */
export const PEAKS_PER_SEC = 20;
/** 超过这个大小的音频不解码，直接用伪波形（字节） */
const MAX_DECODE_BYTES = 40 * 1024 * 1024;

/** 把一段采样下采样成 buckets 个峰值：每格取最大绝对值，再归一化到 0–1 */
export function downsamplePeaks(data: Float32Array, buckets: number): number[] {
  const out = new Array<number>(Math.max(0, buckets)).fill(0);
  if (data.length === 0 || buckets <= 0) return out;
  let max = 0;
  for (let i = 0; i < buckets; i++) {
    const from = Math.floor((i * data.length) / buckets);
    const to = Math.max(from + 1, Math.floor(((i + 1) * data.length) / buckets));
    let peak = 0;
    for (let k = from; k < to && k < data.length; k++) peak = Math.max(peak, Math.abs(data[k]));
    out[i] = peak;
    max = Math.max(max, peak);
  }
  return max > 0 ? out.map((v) => v / max) : out;
}

/** 按种子生成固定的伪波形（还没解码出真实波形时占位），数值在 0.15–1 */
export function pseudoPeaks(seed: string, count: number): number[] {
  const base = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return Array.from({ length: Math.max(0, count) }, (_, i) => {
    const noise = Math.sin(base * 12.9898 + i * 78.233) * 43758.5453;
    const frac = noise - Math.floor(noise);
    return 0.15 + 0.85 * frac * (0.6 + 0.4 * Math.abs(Math.sin((i + base) / 7)));
  });
}

/** 取片段入出点范围内的峰值，重采样成 bars 条（每条取范围内最大值）；超出素材的部分为 0 */
export function windowPeaks(
  peaks: readonly number[],
  peaksPerSec: number,
  inMs: number,
  outMs: number,
  bars: number,
): number[] {
  if (bars <= 0) return [];
  const span = outMs - inMs;
  return Array.from({ length: bars }, (_, i) => {
    const from = Math.floor(((inMs + (i * span) / bars) / 1000) * peaksPerSec);
    const to = Math.max(
      from + 1,
      Math.ceil(((inMs + ((i + 1) * span) / bars) / 1000) * peaksPerSec),
    );
    let peak = 0;
    for (let k = Math.max(0, from); k < to && k < peaks.length; k++)
      peak = Math.max(peak, peaks[k]);
    return peak;
  });
}

/** 已经读过（或正在读）的素材的峰值，按地址缓存；失败缓存为 null，不重复请求 */
const cache = new Map<string, Promise<number[] | null>>();
let audioContext: AudioContext | null = null;

/** 读取并解码素材，返回整条素材的峰值（每秒 PEAKS_PER_SEC 个）；环境不支持或失败为 null */
export function loadPeaks(url: string): Promise<number[] | null> {
  const hit = cache.get(url);
  if (hit) return hit;
  const task = (async () => {
    if (typeof AudioContext === "undefined" || typeof fetch === "undefined") return null;
    try {
      const response = await fetch(url);
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_DECODE_BYTES) return null;
      audioContext ??= new AudioContext();
      const audio = await audioContext.decodeAudioData(buffer);
      return downsamplePeaks(
        audio.getChannelData(0),
        Math.max(1, Math.ceil(audio.duration * PEAKS_PER_SEC)),
      );
    } catch {
      return null;
    }
  })();
  cache.set(url, task);
  return task;
}
