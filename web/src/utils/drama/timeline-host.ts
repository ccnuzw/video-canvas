import type { DramaClipHost } from "@/api/drama/type";
import type { EditorClip } from "@/components/timeline-editor/types";

/**
 * 时间线片段里短剧私有的部分（放在通用片段的 host 字段里）的读写。
 * 单独成文件：API 映射和各种工具函数都要用，又不能互相依赖。
 */

/** 取出片段上的宿主数据；编辑器自己新建的片段（如文字）没有，按片段类型补一份 */
export function hostOf(clip: Pick<EditorClip, "host" | "type">): DramaClipHost {
  if (clip.host) return clip.host as DramaClipHost;
  return {
    kind: clip.type === "text" ? "text" : "asset",
    segmentId: "",
    taskId: "",
    pinned: false,
    assetId: "",
    media: null,
  };
}

/** 片段的素材引用：版本是 take:任务ID，素材是 asset:素材ID；待采用占位和文字没有 */
export function clipRef(host: DramaClipHost): string | null {
  if (host.kind === "segment") return host.taskId ? `take:${host.taskId}` : null;
  if (host.kind === "asset") return host.assetId ? `asset:${host.assetId}` : null;
  return null;
}
