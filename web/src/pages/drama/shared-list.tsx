import service from "@/utils/requests/service";
import { CanvasCover } from "@/components/home/canvas-cover";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { canvasSharing, dramaSharing, type SharedDrama } from "@/api/drama/share";
import { Button } from "@/components/ui/button";

function SharedCover({ item }: { item: SharedDrama }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let objectURL: string | undefined;
    const controller = new AbortController();
    setUrl(null);
    if (item.cover_asset)
      void service
        .get<Blob>(`/canvas/${item.id}/reader/media/${item.cover_asset}`, undefined, {
          responseType: "blob",
          signal: controller.signal,
          silent: true,
        })
        .then(
          (blob) => {
            if (active) {
              objectURL = URL.createObjectURL(blob);
              setUrl(objectURL);
            }
          },
          () => {},
        );
    return () => {
      active = false;
      controller.abort();
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [item.id, item.cover_asset]);
  return (
    <div className="aspect-16/10 overflow-hidden rounded-lg">
      <CanvasCover id={item.id} coverUrl={url} />
    </div>
  );
}
export function SharedDramaList({
  keyword,
  canvas = false,
}: {
  keyword: string;
  canvas?: boolean;
}) {
  const [items, setItems] = useState<SharedDrama[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError(false);
    void (canvas ? canvasSharing : dramaSharing)
      .list(keyword, page)
      .then(
        (data) => {
          if (active) {
            setItems((previous) =>
              page === 1 ? (data.list ?? []) : [...previous, ...(data.list ?? [])],
            );
            setTotal(data.total);
          }
        },
        () => {
          if (active) setError(true);
        },
      )
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [canvas, keyword, page, reload]);
  return (
    <>
      {items.map((item) => (
        <Link
          key={item.id}
          to={`/${canvas ? "canvas" : "drama"}/${item.id}/reader`}
          className="border-border hover:bg-chrome-hover grid min-w-0 gap-2 rounded-xl border p-5"
        >
          {canvas && <SharedCover item={item} />}
          <strong className="truncate">{item.title}</strong>
          <span className="text-muted-foreground text-sm">仅可查看</span>
        </Link>
      ))}
      <div className="col-span-full flex justify-center py-6 text-sm text-muted-foreground">
        {error ? (
          <Button variant="outline" onClick={() => setReload((value) => value + 1)}>
            重新加载
          </Button>
        ) : busy ? (
          "加载中…"
        ) : items.length === 0 ? (
          keyword ? (
            `没有找到匹配的${canvas ? "画布" : "短剧"}`
          ) : (
            `还没有人与你共享${canvas ? "画布" : "短剧"}`
          )
        ) : items.length < total ? (
          <Button variant="outline" onClick={() => setPage(page + 1)}>
            加载更多
          </Button>
        ) : null}
      </div>
    </>
  );
}
