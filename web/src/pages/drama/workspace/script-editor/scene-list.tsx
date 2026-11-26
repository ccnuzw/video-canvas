import { useState } from "react";
import { GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

import type { ScriptEditorApi } from "./use-script-editor";

/**
 * 场次栏：本集每一场的场号、标题（短标题，没有就用地点）和出场人物；点一下，稿纸滚到这一场。
 * 这里不改内容，场次信息在稿纸上改；拖动可以调整场次顺序（场号随之重排）。
 * @param editor 剧本编辑器状态
 * @param no 集号，用来显示场号
 * @param onJump 点场次时，让稿纸滚到这一场
 */
export function SceneList({
  editor,
  no,
  onJump,
}: {
  editor: ScriptEditorApi;
  no: number;
  onJump: (sceneKey: string) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const readOnly = editor.readOnly;
  const person = (id: string | null) => editor.characters.find((c) => c.id === id);
  return (
    <ol className="mb-5 grid gap-0.5">
      {editor.scenes.map((scene, index) => {
        const place = editor.locations.find((l) => l.id === scene.locationId)?.name;
        const cast = [
          ...new Set(
            scene.elements.filter((e) => e.type === "character").map((e) => e.characterId),
          ),
        ];
        return (
          <li
            key={scene.key}
            draggable={!readOnly}
            onDragStart={() => setDragging(scene.key)}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setOver(scene.key);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging) editor.moveScene(dragging, scene.key);
              setDragging(null);
              setOver(null);
            }}
            className={cn(
              "flex items-center gap-1 rounded-xl px-1",
              dragging === scene.key && "opacity-40",
              over === scene.key &&
                dragging !== scene.key &&
                "shadow-[0_-2px_0_var(--status-warning)]",
            )}
          >
            {!readOnly && (
              <GripVertical className="text-muted-foreground size-3.5 shrink-0 cursor-grab" />
            )}
            <button
              type="button"
              onClick={() => onJump(scene.key)}
              className="text-muted-foreground hover:bg-chrome-hover hover:text-foreground focus-visible:ring-ring/50 flex min-h-9 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1.5 text-left text-[13px] transition-colors duration-150 outline-none focus-visible:ring-2"
            >
              <span className="shrink-0 font-mono text-[11px]">
                {no}-{index + 1}
              </span>
              <span className="truncate">{scene.title || place || "未选地点"}</span>
            </button>
            <span className="flex shrink-0 -space-x-1">
              {cast.slice(0, 3).map((id) => {
                const p = person(id);
                return (
                  <span
                    key={id}
                    title={p?.name}
                    className={cn(
                      "ring-background grid size-5 place-items-center rounded-full text-[10px] font-semibold ring-2",
                      p?.canvasNodeId
                        ? "bg-status-warning/15 text-status-warning"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {p?.name.slice(0, 1) ?? "?"}
                  </span>
                );
              })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
