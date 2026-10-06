import type { Card, CardSize } from './types';

/** Pixel dimensions of the card at the centre of a 1920 × 1080 video. */
export const CARD_SIZE_LIMITS = {
  width: { min: 800, max: 1720 },
  height: { min: 360, max: 660 },
} as const;

const DEFAULT_SIZES: CardSize[] = [
  { width: 1440, height: 620 }, { width: 1390, height: 638 },
  { width: 1420, height: 626 }, { width: 1405, height: 632 },
  { width: 1430, height: 612 }, { width: 1380, height: 640 },
];

/** Explicit sizes are final pixels. The previous global scale applies only to defaults. */
export function getCardSize(card: Pick<Card, 'size'>, cardIndex: number, cardScale = 1.2): CardSize {
  if (card.size) return { ...card.size };
  const base = DEFAULT_SIZES[Math.max(0, Math.floor(cardIndex)) % DEFAULT_SIZES.length];
  const scale = Number.isFinite(cardScale) ? Math.max(.7, Math.min(1.2, cardScale)) / 1.2 : 1;
  return {
    width: Math.round(Math.max(CARD_SIZE_LIMITS.width.min, base.width * scale)),
    height: Math.round(Math.max(CARD_SIZE_LIMITS.height.min, base.height * scale)),
  };
}
