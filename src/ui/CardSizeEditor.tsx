'use client';

import React, { useEffect, useState } from 'react';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import type { Card, CardSize } from '../core/types';
import { CARD_SIZE_LIMITS, getCardSize } from '../core/card-layout';

interface Props {
  card: Card;
  cardIndex: number;
  cardScale: number;
  onChange: (size: CardSize | undefined) => void;
}

export default function CardSizeEditor({ card, cardIndex, cardScale, onChange }: Props) {
  const size = getCardSize(card, cardIndex, cardScale);
  const [values, setValues] = useState({ width: String(size.width), height: String(size.height) });

  useEffect(() => {
    setValues({ width: String(size.width), height: String(size.height) });
  }, [card.id, size.width, size.height]);

  const update = (dimension: keyof CardSize, value: number) => {
    const limit = CARD_SIZE_LIMITS[dimension];
    onChange({ ...size, [dimension]: Math.round(Math.min(limit.max, Math.max(limit.min, value))) });
  };
  const commit = (dimension: keyof CardSize) => {
    const value = Number(values[dimension]);
    if (!values[dimension].trim() || !Number.isFinite(value)) {
      setValues(current => ({ ...current, [dimension]: String(size[dimension]) }));
      return;
    }
    const limit = CARD_SIZE_LIMITS[dimension];
    const bounded = Math.round(Math.min(limit.max, Math.max(limit.min, value)));
    setValues(current => ({ ...current, [dimension]: String(bounded) }));
    update(dimension, bounded);
  };

  return <section className="card-size-editor" aria-label="中间卡片尺寸">
    <div className="card-size-heading"><h4>中间卡片尺寸</h4><span>{card.size ? '自定义' : '默认尺寸'}</span></div>
    {(['width', 'height'] as const).map(dimension => {
      const label = dimension === 'width' ? '宽度' : '高度';
      const limit = CARD_SIZE_LIMITS[dimension];
      return <div className="card-size-control" key={dimension}>
        <div className="card-size-label"><span>{label}</span><div className="card-size-number"><input
          type="number" aria-label={`中间卡片${label}`} min={limit.min} max={limit.max} step="1"
          value={values[dimension]}
          onFocus={event => event.target.select()}
          onChange={event => {
            const raw = event.target.value;
            setValues(current => ({ ...current, [dimension]: raw }));
            const value = Number(raw);
            if (raw.trim() && Number.isFinite(value) && value >= limit.min && value <= limit.max) update(dimension, value);
          }}
          onBlur={() => commit(dimension)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        /><span>px</span></div></div>
        <input type="range" aria-label={`调节中间卡片${label}`} min={limit.min} max={limit.max} step="1" value={size[dimension]} onChange={event => update(dimension, Number(event.target.value))} />
        <div className="range-ends"><span>{limit.min}</span><span>{limit.max}</span></div>
      </div>;
    })}
    <div className="card-size-footer"><span>按 1080p 画布设置</span><button type="button" disabled={!card.size} onClick={() => onChange(undefined)}><RefreshRounded />恢复默认</button></div>
    <p>尺寸会实时显示在预览中；保存后用于导出。</p>
  </section>;
}
