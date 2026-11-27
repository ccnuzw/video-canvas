import { driver, type Driver } from "driver.js";
import "driver.js/dist/driver.css";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";

import { DURATION, EASE_OUT_CSS, ms } from "@/lib/motion";

import "./final-tour.css";
import { markTourSeen, tourSeen, tourSteps } from "./final-tour";

/** 时间线就绪后等多久再自动开始（毫秒）：让剪辑台的入场动画先播完 */
const AUTO_START_DELAY = 400;

/**
 * 成片剪辑台的新手引导（driver.js）：第一次打开自动播一遍，`start` 给顶栏「?」按钮重看。
 * 只看不动手：高亮区不可点，点遮罩不关；看完或跳过都记为已看。
 * @param ready 时间线加载好、没有浮层挡着时为 true，才会自动开始
 * @param readOnly 只读时跳过要编辑权限的步骤
 * @param episode 当前集号：切集时结束正在进行的引导
 */
export function useFinalTour({
  ready,
  readOnly,
  episode,
}: {
  ready: boolean;
  readOnly: boolean;
  episode: number;
}) {
  const reduceMotion = useReducedMotion();
  const tourRef = useRef<Driver | null>(null);

  const start = useCallback(() => {
    tourRef.current?.destroy();
    const steps = tourSteps(readOnly, (target) =>
      Boolean(document.querySelector(`[data-tour="${target}"]`)),
    );
    if (steps.length === 0) return;
    const tour = driver({
      steps: steps.map((step) => ({
        element: `[data-tour="${step.target}"]`,
        popover: { title: step.title, description: step.text, side: step.side, align: "start" },
      })),
      // 气泡挂在 body 上，挂 drama-theme 才拿得到剪辑台的主题变量
      popoverClass: "vc-tour drama-theme",
      showProgress: true,
      progressText: "{{current}} / {{total}}",
      prevBtnText: "上一步",
      nextBtnText: "下一步",
      doneBtnText: "知道了",
      closeBtnLabel: "跳过引导",
      showButtons: ["next", "previous", "close"],
      animate: !reduceMotion,
      overlayColor: "#000",
      overlayOpacity: 0.6,
      stagePadding: 6,
      stageRadius: 16,
      allowKeyboardControl: true,
      disableActiveInteraction: true,
      overlayClickBehavior: "none",
      onPopoverRender: (popover) => {
        popover.wrapper.style.setProperty("--motion-in", ms(DURATION.base));
        popover.wrapper.style.setProperty("--motion-ease", EASE_OUT_CSS);
      },
      onDestroyed: () => {
        markTourSeen();
        if (tourRef.current === tour) tourRef.current = null;
      },
    });
    tourRef.current = tour;
    tour.drive();
  }, [readOnly, reduceMotion]);

  // 第一次进来、时间线就绪后自动播一遍
  useEffect(() => {
    if (!ready || tourRef.current?.isActive() || tourSeen()) return;
    const timer = window.setTimeout(start, AUTO_START_DELAY);
    return () => window.clearTimeout(timer);
  }, [ready, start]);

  // 切集或离开成片时结束引导
  useEffect(() => () => tourRef.current?.destroy(), [episode]);

  return { start };
}
