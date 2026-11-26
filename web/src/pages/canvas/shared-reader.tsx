import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { canvasSharing } from "@/api/drama/share";
import { mapCanvasProject } from "@/api/canvas";
import type { BackendCanvasProjectDto, CanvasDetailDto } from "@/api/canvas/type";
import type { CanvasNodeData } from "@/types/canvas";
import service from "@/utils/requests/service";
import "@xyflow/react/dist/style.css";

function Media({ src, kind }: { src?: string | null; kind?: string }) {
  if (!src?.startsWith("/api/v1/canvas-media/")) return null;
  if (kind === "audio") return <audio controls preload="none" src={src} className="w-full" />;
  if (kind === "video") return <video controls preload="metadata" src={src} className="w-full" />;
  return <img loading="lazy" alt="" src={src} className="w-full object-contain" />;
}
function ReadNode({ data }: NodeProps<Node<CanvasNodeData>>) {
  const prompt = typeof data.params?.prompt === "string" ? data.params.prompt : data.prompt;
  return (
    <article className="w-72 space-y-2 rounded-xl border bg-card p-3 text-card-foreground shadow-sm">
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      {prompt && <p className="whitespace-pre-wrap break-words">{prompt}</p>}
      {data.text && <p className="whitespace-pre-wrap break-words">{data.text}</p>}
      <Media src={data.src ?? data.scene?.thumb?.url} kind={data.mediaType} />
      {data.outputs?.length ? (
        <details>
          <summary>已保存结果 · {data.outputs.length}</summary>
          {data.outputs.map((output) => (
            <Media key={output.id} src={output.src} kind={output.mediaType} />
          ))}
        </details>
      ) : null}
      {data.character && (
        <details>
          <summary>
            {data.character.name} · {data.character.look}
          </summary>
          <p>{data.character.description}</p>
          <p>{data.character.voicePrompt}</p>
          {data.character.extras?.map((item) => (
            <Media key={item.assetId} src={item.src} />
          ))}
          <Media src={data.character.voice?.src} kind="audio" />
        </details>
      )}
      {data.storyboard?.shots?.map((shot) => (
        <p key={shot.id}>
          {[
            shot.shot,
            shot.camera,
            shot.scene,
            shot.action,
            shot.dialogue,
            Number.isFinite(shot.duration) ? `${shot.duration} 秒` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          <Media src={shot.image?.src} />
        </p>
      ))}
      {data.paramAssets && (
        <details>
          <summary>参考素材</summary>
          {Object.entries(data.paramAssets).map(([key, item]) => (
            <Media key={key} src={item.url} kind={item.mediaType} />
          ))}
        </details>
      )}
      <Handle type="source" position={Position.Right} />
    </article>
  );
}
const nodeTypes = {
  canvas: ReadNode,
  group: ({ data }: NodeProps) => (
    <div className="h-full rounded-xl border border-dashed bg-muted/25 p-3">
      {String(data.label ?? "分组")}
    </div>
  ),
};
const back = "/canvases?scope=shared-canvas";
export default function SharedCanvasReader() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [canvas, setCanvas] = useState<CanvasDetailDto | null>(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let sequence = 0;
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      controller = new AbortController();
      const request = ++sequence;
      setError(false);
      void service
        .get<BackendCanvasProjectDto>(`/canvas/${id}/reader`, undefined, {
          signal: controller.signal,
          silent: true,
        })
        .then(
          (row) => {
            if (request === sequence) setCanvas(mapCanvasProject(row));
          },
          () => {
            if (request === sequence) {
              setCanvas(null);
              setError(true);
            }
          },
        );
    };
    load();
    window.addEventListener("focus", load);
    return () => {
      sequence++;
      controller?.abort();
      window.removeEventListener("focus", load);
    };
  }, [id, reload]);
  const current = canvas?.id === id ? canvas : null;
  return (
    <main className="flex h-dvh flex-col">
      <header className="flex items-center gap-4 border-b px-5 py-3">
        <Link to={back}>共享给我</Link>
        <strong className="truncate">{current?.title}</strong>
        <span>仅可查看</span>
        <Button variant="ghost" onClick={() => setReload((value) => value + 1)}>
          刷新
        </Button>
        {current && (
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await canvasSharing.remove(id, "me");
                navigate(back, { replace: true });
              } catch {
                toast.error("退出共享失败，请重试");
              }
            }}
          >
            退出共享
          </Button>
        )}
      </header>
      {current ? (
        <ReactFlow
          key={`${id}:${current.version}`}
          nodes={current.graph.nodes}
          edges={current.graph.edges.map(({ id, source, target }) => ({ id, source, target }))}
          nodeTypes={nodeTypes}
          defaultViewport={current.graph.viewport}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      ) : (
        <p className="m-auto">{error ? "画布不可访问，请确认共享权限或重试。" : "正在加载画布…"}</p>
      )}
    </main>
  );
}
