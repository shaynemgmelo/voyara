import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Smooth scroll — inspired by Onwardify / premium landing pages.
 * Call once at the app root.
 */
export default function useSmoothScroll() {
  useEffect(() => {
    // Don't apply on touch devices — native iOS/Android feel is already
    // polished and Lenis on touch can feel unnatural.
    const isTouch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        "ontouchstart" in window);
    if (isTouch) return;

    const lenis = new Lenis({
      duration: 1.15,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
    });

    let rafId;
    const raf = (time) => {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    };
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);
}
