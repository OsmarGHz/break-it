import crypto from 'node:crypto';
import type { AssertionRule, StressScenario, TextSlot } from '../src/shared/types.js';

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16);
}

export function computeComponentHash(
  instrumentedHtml: string,
  slots: TextSlot[]
): string {
  const canonical = JSON.stringify({
    html: instrumentedHtml.trim(),
    slots: slots.map((s) => ({
      id: s.id,
      role: s.role,
      required: s.required,
      originalText: s.originalText,
    })),
  });
  return sha256Hex(canonical);
}

export function computeCssHash(css: string): string {
  return sha256Hex(css.replace(/\r\n/g, '\n').trim());
}

export function computePackHash(
  scenarios: StressScenario[],
  assertions: AssertionRule[]
): string {
  const canonical = JSON.stringify({
    scenarios: scenarios.map((sc) => ({
      id: sc.id,
      viewport: { width: sc.viewport.width, height: sc.viewport.height },
      mutations: [...sc.mutations]
        .sort((a, b) => a.slotId.localeCompare(b.slotId))
        .map((m) => ({ slotId: m.slotId, value: m.value })),
    })),
    assertions: assertions
      .filter((a) => a.enabled)
      .map((a) => ({
        id: a.id,
        type: a.type,
        tolerancePx: a.tolerancePx,
        targetId: a.targetId || null,
        containerId: a.containerId || null,
        secondaryTargetId: a.secondaryTargetId || null,
        minGapPx: a.minGapPx ?? null,
        allowEllipsis: Boolean(a.exception?.allowEllipsis),
        allowOverlap: Boolean(a.exception?.allowOverlap),
      })),
  });
  return sha256Hex(canonical);
}

