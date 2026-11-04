import React from 'react';
import type { HighlightBox, ScenarioRunResult } from '../shared/types';

interface ScreenshotOverlayProps {
  result: ScenarioRunResult;
  activeAssertionId?: string | null;
  showOverlays: boolean;
  compact?: boolean;
}

const ROLE_COLORS: Record<
  HighlightBox['role'],
  { stroke: string; fill: string; badgeBg: string }
> = {
  container: {
    stroke: '#3b82f6',
    fill: 'rgba(59, 130, 246, 0.05)',
    badgeBg: '#1d4ed8',
  },
  target: {
    stroke: '#ef4444',
    fill: 'rgba(239, 68, 68, 0.14)',
    badgeBg: '#b91c1c',
  },
  overflow: {
    stroke: '#f97316',
    fill: 'rgba(249, 115, 22, 0.16)',
    badgeBg: '#c2410c',
  },
  clip: {
    stroke: '#eab308',
    fill: 'rgba(234, 179, 8, 0.12)',
    badgeBg: '#a16207',
  },
  secondary: {
    stroke: '#a855f7',
    fill: 'rgba(168, 85, 247, 0.12)',
    badgeBg: '#7e22ce',
  },
};

export const ScreenshotOverlay: React.FC<ScreenshotOverlayProps> = ({
  result,
  activeAssertionId,
  showOverlays,
  compact = false,
}) => {
  if (!result.screenshotUrl || !result.documentMetrics) {
    return (
      <div className="empty-capture">
        {result.renderError
          ? `Render error: ${result.renderError}`
          : 'No screenshot captured for this scenario.'}
      </div>
    );
  }

  const { scrollWidth, scrollHeight, viewportWidth } = result.documentMetrics;

  // Collect highlight boxes either from the focused assertion or all failing assertions
  const boxes: HighlightBox[] = [];
  if (showOverlays) {
    if (activeAssertionId) {
      const found = result.assertions.find((a) => a.assertionId === activeAssertionId);
      if (found) {
        boxes.push(...found.highlightBoxes);
      }
    } else {
      const failing = result.assertions.filter((a) => a.status !== 'pass');
      const seenKeys = new Set<string>();
      for (const f of failing) {
        for (const b of f.highlightBoxes) {
          const key = `${b.role}:${Math.round(b.rect.x)}:${Math.round(b.rect.y)}:${Math.round(b.rect.width)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            boxes.push(b);
          }
        }
      }
    }
  }

  const hasViewportSpill = scrollWidth > viewportWidth + 1.5;

  return (
    <div className={`capture-stage ${compact ? 'capture-stage--compact' : ''}`}>
      <div
        className="capture-canvas"
        style={{
          maxWidth: compact ? '100%' : `${Math.min(scrollWidth, 640)}px`,
        }}
      >
        <img
          src={result.screenshotUrl}
          alt={`Rendered capture for ${result.scenarioName}`}
          className="capture-img"
          loading="lazy"
        />
        {showOverlays && (
          <svg
            className="capture-svg-overlay"
            viewBox={`0 0 ${scrollWidth} ${scrollHeight}`}
            preserveAspectRatio="xMinYMin meet"
          >
            {hasViewportSpill && (
              <g>
                <rect
                  x={viewportWidth}
                  y={0}
                  width={Math.max(0, scrollWidth - viewportWidth)}
                  height={scrollHeight}
                  fill="rgba(239, 68, 68, 0.08)"
                />
                <line
                  x1={viewportWidth}
                  y1={0}
                  x2={viewportWidth}
                  y2={scrollHeight}
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
                <rect
                  x={Math.max(4, viewportWidth - 118)}
                  y={6}
                  width={112}
                  height={18}
                  rx={4}
                  fill="#0e7490"
                />
                <text
                  x={Math.max(10, viewportWidth - 112)}
                  y={18}
                  fill="#ffffff"
                  fontSize="10"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {`Viewport ${viewportWidth}px →`}
                </text>
              </g>
            )}

            {boxes.map((box, idx) => {
              const palette = ROLE_COLORS[box.role];
              const isDashed = box.role === 'container' || box.role === 'clip';
              const showPillLabel =
                !compact &&
                (Boolean(activeAssertionId) || box.role !== 'container');
              const pillWidth = Math.min(180, Math.max(48, box.label.length * 6.2 + 12));
              const pillX = Math.max(4, Math.min(scrollWidth - pillWidth - 4, box.rect.x));
              const pillY = box.rect.y > 20 ? box.rect.y - 17 : box.rect.bottom + 3;

              return (
                <g key={`${box.label}-${idx}`}>
                  <rect
                    x={box.rect.x}
                    y={box.rect.y}
                    width={Math.max(2, box.rect.width)}
                    height={Math.max(2, box.rect.height)}
                    fill={palette.fill}
                    stroke={palette.stroke}
                    strokeWidth={box.role === 'container' ? 1.5 : 2}
                    strokeDasharray={isDashed ? '5 3' : undefined}
                    rx={3}
                  />
                  {showPillLabel && (
                    <g>
                      <rect
                        x={pillX}
                        y={pillY}
                        width={pillWidth}
                        height={15}
                        rx={3.5}
                        fill={palette.badgeBg}
                        opacity={0.92}
                      />
                      <text
                        x={pillX + 5}
                        y={pillY + 10.5}
                        fill="#ffffff"
                        fontSize="9.2"
                        fontWeight="600"
                        fontFamily="JetBrains Mono, monospace"
                      >
                        {box.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};
