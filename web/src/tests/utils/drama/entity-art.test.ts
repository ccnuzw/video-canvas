import { describe, expect, test } from "bun:test";

import type { RefAsset } from "@/utils/drama/segment-assets";
import { entityArt } from "@/utils/drama/entity-art";

/** 人物卡、地点卡上的图：从画布上的资产节点里按名字找，没有就是占位。 */

const asset = (type: RefAsset["type"], name: string, src: string | null, look = ""): RefAsset => ({
  id: `${type}-${name}-${look}`,
  type,
  name,
  look,
  label: name,
  episodes: [],
  kind: "image",
  src,
  generating: false,
});

const assets = [
  asset("character", "迅哥儿", "/xun.png", "少年、成年画外音"),
  asset("character", "闰土", "/run-young.png", "少年"),
  asset("character", "闰土父亲", "/father.png"),
  asset("character", "母亲", null),
  asset("scene", "周家大院", "/yard.png"),
  asset("scene", "周家厨房", "/kitchen.png"),
  asset("scene", "月夜瓜地", null),
  asset("prop", "钢叉", "/fork.png"),
];

describe("entityArt", () => {
  test("人物按名字精确匹配，只看角色资产；名字相近的不混用", () => {
    expect(entityArt({ name: "迅哥儿", aliases: [] }, "character", assets)).toBe("/xun.png");
    expect(entityArt({ name: "闰土", aliases: [] }, "character", assets)).toBe("/run-young.png");
    // 「闰土父亲」要拿自己的图，不能因为包含「闰土」拿到闰土的
    expect(entityArt({ name: "闰土父亲", aliases: [] }, "character", assets)).toBe("/father.png");
    // 「迅哥儿的父亲」没有自己的资产，也不该拿迅哥儿的图
    expect(entityArt({ name: "迅哥儿的父亲", aliases: [] }, "character", assets)).toBeNull();
  });

  test("别名也能对上；资产还没出图返回 null", () => {
    expect(entityArt({ name: "少年闰土", aliases: ["闰土"] }, "character", assets)).toBe(
      "/run-young.png",
    );
    expect(entityArt({ name: "母亲", aliases: [] }, "character", assets)).toBeNull();
  });

  test("地点只看场景资产；名字不完全一样但包含场景名时也算（周家大院·祠堂与内院）", () => {
    expect(entityArt({ name: "周家厨房", aliases: [] }, "location", assets)).toBe("/kitchen.png");
    expect(entityArt({ name: "周家大院·祠堂与内院", aliases: [] }, "location", assets)).toBe(
      "/yard.png",
    );
    expect(entityArt({ name: "周家厨房与大门口", aliases: [] }, "location", assets)).toBe(
      "/kitchen.png",
    );
    // 道具和人物不会被当成场景图
    expect(entityArt({ name: "钢叉", aliases: [] }, "location", assets)).toBeNull();
    expect(entityArt({ name: "迅哥儿", aliases: [] }, "location", assets)).toBeNull();
  });

  test("精确匹配优先于包含；忽略空白、间隔号和引号；同名有多个造型取有图的", () => {
    const list = [
      asset("scene", "周家大院", "/a.png"),
      asset("scene", "周家大院·祠堂与内院", "/b.png"),
      asset("character", "成年“我”", "/me.png"),
      asset("character", "闰土", null, "少年"),
      asset("character", "闰土", "/run-old.png", "成年"),
    ];
    expect(entityArt({ name: "周家大院 · 祠堂与内院", aliases: [] }, "location", list)).toBe(
      "/b.png",
    );
    expect(entityArt({ name: '成年"我"', aliases: [] }, "character", list)).toBe("/me.png");
    expect(entityArt({ name: "闰土", aliases: [] }, "character", list)).toBe("/run-old.png");
  });
});
