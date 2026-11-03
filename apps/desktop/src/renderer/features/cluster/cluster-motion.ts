/** Codex floating-summary motion, verified from package 26.1027.6604.0 through REA. */
export const clusterPanelVariants = {
  hidden: { opacity: 0, transform: 'translateX(100%)' },
  visible: { opacity: 1, transform: 'translateX(0%)' },
};

/** Shared by the summary and canvas reservation; camera zoom is never animated here. */
export const clusterPanelSpring = { type: 'spring', duration: 0.3, bounce: 0.01 } as const;
