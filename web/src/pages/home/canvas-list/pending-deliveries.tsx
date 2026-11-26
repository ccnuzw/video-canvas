import { useEffect, useState } from "react";
import { toast } from "sonner";
import { checkCanvasReceipt, pendingCanvasReceipts } from "@/api/drama/share";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/utils/requests/request";

export function PendingDeliveries({ onComplete }: { onComplete: () => void }) {
  const [items, setItems] = useState(pendingCanvasReceipts);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setItems(pendingCanvasReceipts());
    window.addEventListener("canvas-delivery-change", refresh);
    return () => window.removeEventListener("canvas-delivery-change", refresh);
  }, []);
  async function check(item: (typeof items)[number]) {
    setBusy(item.key);
    try {
      const status = await checkCanvasReceipt(item);
      if (status === "complete") {
        toast.success(item.mode === "transfer" ? "已转移所有权" : "副本已送达");
        onComplete();
      } else if (status === "failed") toast.error("本次交付失败，可从原画布重试");
      else toast.info("交付正在处理，可稍后再次核对");
    } catch (err) {
      toast.error(
        err instanceof ApiError && err.status === 404
          ? "尚未查到这次交付，可用相同邮箱和方式重试"
          : "暂时无法核对，请稍后重试",
      );
    } finally {
      setBusy(null);
    }
  }
  return items.map((item) => (
    <div key={item.key} className="mb-3 flex flex-wrap items-center gap-3 text-sm">
      <span>
        画布 {item.id} · {item.mode === "transfer" ? "转移所有权" : "发送副本"}给 {item.email}
      </span>
      <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void check(item)}>
        核对交付结果
      </Button>
    </div>
  ));
}
