/**
 * 给媒体元素设音量。
 * 元素自带的 volume 最大 1，要超过 100% 只能走 Web Audio 的 GainNode；
 * 但跨域媒体没有 CORS 头时接进 Web Audio 会变成静音，所以只对同源或声明了 crossOrigin 的元素这样做，
 * 其余的夹到 1。
 */

let context: AudioContext | null | undefined;

/** 每个元素对应的增益节点；null 表示这个元素接不进去 */
const nodes = new WeakMap<HTMLMediaElement, GainNode | null>();

/** 共用的 AudioContext；环境不支持返回 null */
function audioContext(): AudioContext | null {
  if (context !== undefined) return context;
  try {
    context = typeof AudioContext === "undefined" ? null : new AudioContext();
  } catch {
    context = null;
  }
  return context;
}

/** 这个元素能不能安全接进 Web Audio（同源，或已声明 CORS） */
function boostable(element: HTMLMediaElement): boolean {
  if (element.crossOrigin) return true;
  try {
    return new URL(element.currentSrc || element.src, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** 浏览器要求用户操作后才允许出声：开始播放时调用 */
export function resumeAudio(): void {
  void audioContext()?.resume();
}

/** 设置元素的增益（1 = 原音量，最大 2） */
export function applyGain(element: HTMLMediaElement, gain: number): void {
  const wanted = Math.min(2, Math.max(0, gain));
  let node = nodes.get(element);
  if (node === undefined && wanted > 1) {
    const ctx = audioContext();
    node = null;
    if (ctx && boostable(element)) {
      try {
        node = ctx.createGain();
        ctx.createMediaElementSource(element).connect(node);
        node.connect(ctx.destination);
      } catch {
        node = null;
      }
    }
    nodes.set(element, node);
  }
  if (node) {
    node.gain.value = wanted;
    element.volume = 1;
  } else {
    element.volume = Math.min(1, wanted);
  }
}
