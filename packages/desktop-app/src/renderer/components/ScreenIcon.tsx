import React from 'react';
import { ScreenIconDTO } from '../../shared/dtos';

/**
 * A 16x16 bar icon, one square per LED, on the black the bar shows it on.
 * SVG rather than a scaled image so the pixels stay sharp at any size.
 */
export const ScreenIcon: React.FC<{ icon: ScreenIconDTO; className?: string }> = ({ icon, className }) => (
  <span role="img" aria-label={icon.label} title={icon.label} className={`shrink-0 inline-flex rounded-sm bg-black ${className ?? ''}`}>
    <svg viewBox="0 0 16 16" className="w-full h-full" shapeRendering="crispEdges" aria-hidden="true">
      {icon.pixels.flatMap((row, y) =>
        row.map((color, x) => (color ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} /> : null))
      )}
    </svg>
  </span>
);
