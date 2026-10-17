import { useState } from 'react';
import type { PointerEvent } from 'react';
import type { PixelImage, Point } from '../lib/warp';

interface CornerCropEditorProps {
  source: string;
  alt: string;
  pixels: PixelImage;
  corners: [Point, Point, Point, Point];
  onChange: (corners: [Point, Point, Point, Point]) => void;
  filter?: string;
}

export default function CornerCropEditor({ source, alt, pixels, corners, onChange, filter }: CornerCropEditorProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const moveCorner = (event: PointerEvent<SVGSVGElement>) => {
    if (dragging === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const next = [...corners] as [Point, Point, Point, Point];
    next[dragging] = {
      x: Math.max(0, Math.min(pixels.width - 1, ((event.clientX - bounds.left) / bounds.width) * pixels.width)),
      y: Math.max(0, Math.min(pixels.height - 1, ((event.clientY - bounds.top) / bounds.height) * pixels.height)),
    };
    onChange(next);
  };

  return (
    <div className="scan-preview">
      <img src={source} alt={alt} style={{ filter }} />
      <svg
        className="scan-overlay"
        viewBox={`0 0 ${pixels.width} ${pixels.height}`}
        preserveAspectRatio="none"
        onPointerMove={moveCorner}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
      >
        <polygon points={corners.map((point) => `${point.x},${point.y}`).join(' ')} />
        {corners.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={Math.max(8, pixels.width / 45)}
            aria-label={`Crop corner ${index + 1}`}
            onPointerDown={(event) => {
              event.preventDefault();
              setDragging(index);
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
          />
        ))}
      </svg>
    </div>
  );
}
