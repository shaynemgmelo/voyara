import React from "react";
import { motion } from "framer-motion";

const PRESETS = {
  up: { hidden: { opacity: 0, y: 40 }, show: { opacity: 1, y: 0 } },
  down: { hidden: { opacity: 0, y: -40 }, show: { opacity: 1, y: 0 } },
  left: { hidden: { opacity: 0, x: -40 }, show: { opacity: 1, x: 0 } },
  right: { hidden: { opacity: 0, x: 40 }, show: { opacity: 1, x: 0 } },
  scale: {
    hidden: { opacity: 0, scale: 0.92 },
    show: { opacity: 1, scale: 1 },
  },
  fade: { hidden: { opacity: 0 }, show: { opacity: 1 } },
};

/**
 * Reveal — wraps children with a scroll-triggered fade/slide animation.
 * Runs once when it enters viewport (Onwardify-style reveal-on-scroll).
 *
 * Usage:
 *   <Reveal>   — default fade + slide up
 *   <Reveal direction="left" delay={0.2}>
 *   <Reveal preset="scale">
 */
export function Reveal({
  children,
  direction = "up",
  preset,
  delay = 0,
  duration = 0.7,
  once = true,
  amount = 0.25,
  className,
  style,
  as = "div",
}) {
  const variant = PRESETS[preset || direction] || PRESETS.up;
  const MotionTag = motion[as] || motion.div;

  return (
    <MotionTag
      className={className}
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
      variants={variant}
      transition={{
        duration,
        delay,
        ease: [0.21, 0.5, 0.3, 1], // smooth premium cubic
      }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * RevealStagger — animate multiple children with a staggered delay.
 * Wrap a group of items. Each direct child fades in after the previous.
 */
export function RevealStagger({
  children,
  stagger = 0.08,
  initialDelay = 0,
  direction = "up",
  className,
  style,
}) {
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
      style={style}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
      variants={parentVariants}
    >
      {React.Children.map(children, (child, i) => (
        <motion.div
          key={i}
          variants={childVariants}
          transition={{ duration: 0.65, ease: [0.21, 0.5, 0.3, 1] }}
        >
          {child}
        </motion.div>
      ))}
    </motion.div>
  );
}
