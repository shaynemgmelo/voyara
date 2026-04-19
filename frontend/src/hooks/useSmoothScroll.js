import { useEffect } from "react";
import Lenis from "lenis";

/**
 * Smooth scroll — tuned for a fluid, professional feel.
 * Snappy response (~0.7s) with premium easing, never lagging.
 */
export default function useSmoothScroll() {
  useEffect(() => {
    // Skip on touch devices and when user prefers reduced motion
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const isTouch =
      typeof window !== "undefined" &&
      (window.matchMedia?.("(pointer: coarse)").matches ||
        "ontouchstart" in window);
    if (reducedMotion || isTouch) return;

    const lenis = new Lenis({
      // Much snappier than before — feels responsive, not draggy
      duration: 0.7,
      // Exponential easing (Onwardify-like): fast start, soft landing
      easing: (t) => 1 - Math.pow(1 - t, 3),
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 2,
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
