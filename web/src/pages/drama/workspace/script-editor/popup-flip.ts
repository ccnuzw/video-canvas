import type { Popover as PopoverPrimitive } from "@base-ui/react/popover";

/**
 * 稿纸上的弹层（类型菜单、人物 / 地点选择、时间 / 内外景）的碰撞策略：
 * 下方放不下就翻到上方、上方放不下就留在下方，水平方向平移不出屏。
 * 稿纸很长、触发的行可能贴着窗口底部，固定朝下会被压成一条带滚动条的窄框。
 */
export const FLIP_COLLISION: NonNullable<PopoverPrimitive.Positioner.Props["collisionAvoidance"]> =
  { side: "flip", align: "shift", fallbackAxisSide: "none" };
