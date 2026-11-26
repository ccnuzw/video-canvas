import { Maximize2, Trash2, Volume2, VolumeX } from "lucide-react";

import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";

import type { ClipMedia, EditorClip, TimelineEditorHost } from "../types";

/**
 * 片段右键菜单的内容：宿主追加的项（如换版本），再加静音、恢复原长、删除。
 * 图片和文字没有声音，文字没有原长，占位和失效的素材不能恢复原长。
 */
export function ClipMenuContent({
  clip,
  media,
  host,
  onMute,
  onRestore,
  onRemove,
}: {
  /** 右键的片段 */
  clip: EditorClip;
  /** 它的素材解析结果；文字为 null */
  media: ClipMedia | null;
  /** 宿主 */
  host: TimelineEditorHost;
  /** 切换静音 */
  onMute: () => void;
  /** 恢复原长 */
  onRestore: () => void;
  /** 删除 */
  onRemove: () => void;
}) {
  const extra = host.clipMenu?.(clip) ?? [];
  const ready = media?.state === "ready";
  const silent = clip.type === "image" || clip.type === "text" || !ready;
  return (
    <ContextMenuContent className="min-w-52">
      {extra.map((item) => (
        <ContextMenuItem
          key={item.id}
          variant={item.danger ? "destructive" : "default"}
          onClick={item.run}
        >
          {item.label}
        </ContextMenuItem>
      ))}
      {extra.length > 0 && <ContextMenuSeparator />}
      <ContextMenuItem disabled={silent} onClick={onMute}>
        {clip.muted ? <Volume2 /> : <VolumeX />}
        {clip.muted ? "取消静音" : "静音此段"}
      </ContextMenuItem>
      <ContextMenuItem disabled={clip.type === "text" || !ready} onClick={onRestore}>
        <Maximize2 />
        {clip.type === "image" ? "恢复默认 3 秒" : "恢复原长"}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onRemove}>
        <Trash2 />
        删除
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
