import type { ScriptEntityKind } from "@/api/drama/type";

import type { RefAsset } from "./segment-assets";

/** 名字比较用：去掉空白、间隔号、各种引号，统一小写 */
const norm = (text: string) => text.replace(/[\s·・.．"'“”‘’「」『』]/g, "").toLowerCase();

/**
 * 人物卡、地点卡上的图：从画布的资产节点里按名字找，找不到（或资产还没出图）返回 null，卡片继续显示占位。
 * 人物只认角色资产、名字（含别名）完全一致；地点只认场景资产，完全一致优先，
 * 其次名字互相包含（地点表里的「周家大院·祠堂与内院」对应拆解出的场景「周家大院」）。
 * 人物不做包含匹配：「闰土父亲」「迅哥儿的父亲」不能拿到「闰土」「迅哥儿」的图。
 * 同名有多个造型时取有图的第一个。
 * 名字对不上的（拆解时模型起了另一个名字）要等资产拆解按人物表、地点表来建，才能一一对应。
 * @param entity 人物或地点（名字和别名）
 * @param kind 人物或地点
 * @param assets 画布上的资产节点
 */
export function entityArt(
  entity: { name: string; aliases: readonly string[] },
  kind: ScriptEntityKind,
  assets: readonly RefAsset[],
): string | null {
  const type = kind === "character" ? "character" : "scene";
  const pool = assets.filter((asset) => asset.type === type);
  const names = [entity.name, ...entity.aliases].map(norm).filter(Boolean);
  const imageOf = (hit: (assetName: string) => boolean) =>
    pool.find((asset) => asset.src && hit(norm(asset.name)))?.src ?? null;
  const exact = imageOf((assetName) => names.includes(assetName));
  if (exact || kind === "character") return exact;
  return imageOf((assetName) =>
    names.some(
      (name) => assetName.length >= 2 && (name.includes(assetName) || assetName.includes(name)),
    ),
  );
}
