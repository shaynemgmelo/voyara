import React from "react";
import { motion, useReducedMotion } from "framer-motion";

const PRESETS = {
  up: { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0 } },
  down: { hidden: { opacity: 0, y: -24 }, show: { opacity: 1, y: 0 } },
  left: { hidden: { opacity: 0, x: -24 }, show: { opacity: 1, x: 0 } },
  right: { hidden: { opacity: 0, x: 24 }, show: { opacity: 1, x: 0 } },
  scale: {
    hidden: { opacity: 0, scale: 0.96 },
    show: { opacity: 1, scale: 1 },
  },
  fade: { hidden: { opacity: 0 }, show: { opacity: 1 } },
};

// Fast, snappy cubic-bezier (easeOutExpo-like)
const EASE = [0.16, 1, 0.3, 1];

/**
 * Reveal — scroll-triggered reveal with hardware acceleration.
 * Tuned for responsiveness, not slow drama.
 */
export function Reveal({
  children,
  direction = "up",
  preset,
  delay = 0,
  duration = 0.45,
  once = true,
  amount = 0.1,
  className,
  style,
  as = "div",
}) {
  const reduced = useReducedMotion();
  const variant = PRESETS[preset || direction] || PRESETS.up;
  const MotionTag = motion[as] || motion.div;

  if (reduced) {
    const Tag = as;
    return (
      <Tag className={className} style={style}>
        {children}
      </Tag>
    );
  }

  return (
    <MotionTag
      className={className}
      style={{ willChange: "transform, opacity", ...(style || {}) }}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      variants={variant}
      transition={{ duration, delay, ease: EASE }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * RevealStagger — staggered children. Fast cascade (default 60ms).
 */
export function RevealStagger({
  children,
  stagger = 0.06,
  initialDelay = 0,
  direction = "up",
  duration = 0.4,
  className,
  style,
}) {
  const reduced = useReducedMotion();

  if (reduced) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }

  const parentVariants = {
    hidden: {},
    show: {
      transition: {
        staggerChildren: stagger,
        delayChildren: initialDelay,
      },
    },
  };
  const childVariants = PRESETS[direction] || PRESETS.up;

  return (
    <motion.div
      className={className}
      style={{ willChange: "transform, opacity", ...(style || {}) }}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.1 }}
      variants={parentVariants}
    >
      {React.Children.map(children, (child, i) => (
        <motion.div
          key={i}
          variants={childVariants}
          transition={{ duration, ease: EASE }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
