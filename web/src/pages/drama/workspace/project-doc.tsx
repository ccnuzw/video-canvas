import { FilePenLine } from "lucide-react";

import { useDramaAssets } from "@/hooks/use-drama-assets";
import { useSharedWorkspace } from "@/hooks/use-shared-workspace";
import { useDramaJobsStore } from "@/store/drama";

import { cn } from "@/lib/utils";
import { isRevisionConflict } from "@/api/drama/errors";
import type { ScriptDoc } from "@/utils/drama/stages";

import { AnalyzingView, useAnalyzing } from "./analyzing-view";
import { useWorkspace } from "./context";
import { DocEditor } from "./doc-editor";
import { EntityWall } from "./script-editor/entity-wall";

/**
 * 稿纸的排版：集名用衬线粗体，场次标题（二到四级标题）是等宽灰底的小标签，
 * 角色名、台词沿用编辑器自带的样式。浅色是米白纸，深色是比底色亮一档的纸。
 */
export const PAPER_PROSE =
  "[&_h1]:font-display [&_h1]:font-black [&_h1]:tracking-wide " +
  "[&_h2]:bg-muted [&_h2]:inline-flex [&_h2]:rounded-md [&_h2]:px-3 [&_h2]:py-1.5 [&_h2]:font-mono [&_h2]:text-[12.5px] [&_h2]:tracking-wider " +
  "[&_h3]:bg-muted [&_h3]:inline-flex [&_h3]:rounded-md [&_h3]:px-3 [&_h3]:py-1.5 [&_h3]:font-mono [&_h3]:text-[12.5px] [&_h3]:tracking-wider";

/**
 * 剧本页分集栏顶上的项目文档：故事大纲是一篇可编辑的稿纸（研读时生成，随短剧一起保存，同一个 revision）；
 * 人物、地点是卡片墙，直接读写剧本人物表、地点表（研读生成的人物传记由后端拆进人物表）。
 * 研读中大纲 / 人物还没写出来时显示研读进度，不给编辑，免得手写的内容被生成结果盖掉。
 */
export function ProjectDoc({ doc }: { doc: ScriptDoc }) {
  const shared = useSharedWorkspace();
  const { drama, patch, reportSave, refresh } = useWorkspace();
  const { analyzing, paused } = useAnalyzing();
  // 资产拆解、出图收尾后重读画布，人物卡、地点卡上的图跟着换
  const settled = useDramaJobsStore((state) => state.settled[drama.id] ?? 0);
  const { assets } = useDramaAssets(drama.canvasId, settled);
  const waiting = analyzing || paused;
  if (doc !== "outline") {
    if (shared) {
      // 分享链接只读，快照里没有人物表和地点表：人物显示研读生成的人物传记原文，地点没有资料
      return (
        <div className="mx-auto w-full max-w-[720px] px-6 pt-6 pb-28 max-sm:px-3">
          <h2 className="font-display text-[22px] font-black tracking-wide">
            {doc === "characters" ? "人物" : "地点"}
          </h2>
          {doc === "characters" && drama.charactersMd && (
            <div
              className={cn(
                "bg-paper text-paper-foreground ring-border mt-4 rounded-t-md rounded-b-2xl px-[clamp(20px,6vw,72px)] py-12 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.5)] ring-1",
                PAPER_PROSE,
              )}
            >
              <DocEditor
                key={doc}
                value={drama.charactersMd}
                revision={drama.revision}
                editable={false}
                isConflict={isRevisionConflict}
                onStatus={() => {}}
                onSave={async () => drama.revision}
              />
            </div>
          )}
        </div>
      );
    }
    if (doc === "characters" && waiting && !drama.charactersMd) {
      return (
        <div className="mx-auto w-full max-w-[720px] px-6 pt-6 pb-28 max-sm:px-3">
          <h2 className="font-display text-[22px] font-black tracking-wide">人物</h2>
          <AnalyzingView />
        </div>
      );
    }
    return (
      <EntityWall
        key={doc}
        dramaId={drama.id}
        kind={doc === "characters" ? "character" : "location"}
        assets={assets}
        onChanged={() => void refresh()}
      />
    );
  }
  const markdown = drama.outlineMd;
  if (waiting && !markdown) {
    return (
      <div className="mx-auto w-full max-w-[720px] px-6 pt-6 pb-28 max-sm:px-3">
        <h2 className="font-display text-[22px] font-black tracking-wide">故事大纲</h2>
        <AnalyzingView />
      </div>
    );
  }
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 pt-6 pb-28 max-sm:px-3">
      <h2 className="font-display text-[22px] font-black tracking-wide">故事大纲</h2>
      {!markdown && (
        <div className="text-muted-foreground mt-10 flex flex-col items-center gap-1 text-center text-sm">
          <FilePenLine className="size-7" />
          <div>还没有故事大纲</div>
        </div>
      )}
      <div
        className={cn(
          "bg-paper text-paper-foreground ring-border mt-4 rounded-t-md rounded-b-2xl px-[clamp(20px,6vw,72px)] py-12 shadow-[0_24px_60px_-24px_rgb(0_0_0/0.5)] ring-1",
          PAPER_PROSE,
        )}
      >
        <DocEditor
          key={doc}
          value={markdown}
          revision={drama.revision}
          editable={!shared}
          isConflict={isRevisionConflict}
          onStatus={(status) => reportSave(doc, status)}
          onSave={(next) => patch({ outlineMd: next })}
        />
      </div>
    </div>
  );
}
