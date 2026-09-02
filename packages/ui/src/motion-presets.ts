export const motionPresets = {
  standardReveal: { type: 'spring', stiffness: 305, damping: 33 },
  snappyInteraction: { type: 'spring', stiffness: 1218, damping: 70 },
  ambientFloat: { type: 'spring', stiffness: 43, damping: 13 },
} as const;

export type MotionPresetName = keyof typeof motionPresets;
