import type {
  AssertionResult,
  AssertionRule,
  BoundingBox,
  HighlightBox,
  TextSlot,
  VerificationStatus,
} from '../src/shared/types.js';

export interface RawElementInspection {
  exists: boolean;
  tag: string;
  rect: BoundingBox | null;
  textRangeRect: BoundingBox | null;
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  normalizedText: string;
  display: string;
  visibility: string;
  effectiveOpacity: number;
  fontSizePx: number;
  overflowX: string;
  overflowY: string;
  textOverflow: string;
  whiteSpace: string;
  colorAlpha: number;
  contrastDelta: number;
  clippingAncestor: {
    tag: string;
    rect: BoundingBox;
    clippedHorizontallyPx: number;
    clippedVerticallyPx: number;
  } | null;
  occludedByTag: string | null;
}

export interface RawPageInspection {
  viewportWidth: number;
  viewportHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  maxUnclippedRight: number;
  minUnclippedLeft: number;
  overflowingDescendant: {
    tag: string;
    id: string | null;
    rect: BoundingBox;
    protrusionRightPx: number;
    protrusionLeftPx: number;
  } | null;
  elements: Record<string, RawElementInspection>;
}

export function buildIsolatedRenderDocumentWithFonts(
  mutatedHtml: string,
  sanitizedCss: string,
  fontFaceCss: string
): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none';" />
    <style id="breakit-font-harness">
      ${fontFaceCss}
      *, *::before, *::after {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
      }
      html, body {
        margin: 0;
        padding: 0;
        background: #eef2f6;
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #breakit-stage {
        box-sizing: border-box;
        width: 100%;
        padding: 16px;
      }
    </style>
    <style id="breakit-component-css">
      ${sanitizedCss}
    </style>
  </head>
  <body>
    <main id="breakit-stage">
      ${mutatedHtml}
    </main>
  </body>
</html>`;
}

export function collectInspectionTargetIds(
  rootTargetId: string,
  slots: Array<{ id: string }>,
  assertions: AssertionRule[],
  extraTargetIds: string[] = []
): string[] {
  const set = new Set<string>([rootTargetId, ...extraTargetIds]);
  for (const s of slots) set.add(s.id);
  for (const a of assertions) {
    if (a.targetId) set.add(a.targetId);
    if (a.containerId) set.add(a.containerId);
    if (a.secondaryTargetId) set.add(a.secondaryTargetId);
  }
  return Array.from(set);
}

/**
 * Generates the pure-JS string expression evaluated via CDP in Chromium.
 * Kept free of bundler helpers so both server/renderer.ts and repro/reproduce.mjs
 * execute the exact same browser inspection logic.
 */
export function buildBrowserInspectionExpression(
  ids: string[],
  rootId: string
): string {
  const inspectPayload = JSON.stringify({ ids, rootId });
  return `(() => {
    const { ids, rootId } = ${inspectPayload};
    const toBox = (r) => ({
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      right: r.right,
      bottom: r.bottom,
    });

    const parseRgba = (cssColor) => {
      const m = String(cssColor || '').match(
        /rgba?\\(\\s*([\\d.]+)\\s*,\\s*([\\d.]+)\\s*,\\s*([\\d.]+)(?:\\s*[,/]\\s*([\\d.]+))?\\s*\\)/i
      );
      if (!m) return [0, 0, 0, 1];
      return [
        Number(m[1]),
        Number(m[2]),
        Number(m[3]),
        m[4] !== undefined ? Number(m[4]) : 1,
      ];
    };

    const getEffectiveBackground = (el) => {
      let cur = el;
      while (cur) {
        const bg = window.getComputedStyle(cur).backgroundColor;
        const [r, g, b, a] = parseRgba(bg);
        if (a >= 0.2) return [r, g, b];
        cur = cur.parentElement;
      }
      return [238, 242, 246];
    };

    const getEffectiveOpacity = (el) => {
      let op = 1;
      let cur = el;
      while (cur) {
        const style = window.getComputedStyle(cur);
        if (style.display === 'none') return 0;
        const v = parseFloat(style.opacity || '1');
        if (!Number.isNaN(v)) op *= v;
        cur = cur.parentElement;
      }
      return op;
    };

    const getTextRangeBox = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      return toBox(r);
    };

    const vpW = window.innerWidth;
    const vpH = window.innerHeight;
    const docEl = document.documentElement;
    const scrollW = Math.max(docEl.scrollWidth, document.body ? document.body.scrollWidth : 0);
    const scrollH = Math.max(docEl.scrollHeight, document.body ? document.body.scrollHeight : 0);

    const rootEl = document.querySelector('[data-breakit-id="' + rootId + '"]');
    const rootRect = rootEl ? rootEl.getBoundingClientRect() : null;

    let maxUnclippedRight = rootRect ? rootRect.right : 0;
    let minUnclippedLeft = rootRect ? rootRect.left : 0;
    let overflowingDescendant = null;
    let worstProtrusion = 0;

    if (rootEl && rootRect) {
      const allDescendants = rootEl.querySelectorAll('*');
      allDescendants.forEach((desc) => {
        const st = window.getComputedStyle(desc);
        if (st.display === 'none' || st.visibility === 'hidden') return;
        const dr = desc.getBoundingClientRect();
        if (dr.width <= 0 || dr.height <= 0) return;

        let visLeft = dr.left;
        let visRight = dr.right;
        let anc = desc.parentElement;
        while (anc) {
          const ast = window.getComputedStyle(anc);
          if (ast.overflowX !== 'visible') {
            const ar = anc.getBoundingClientRect();
            const clientLeft = ar.left + anc.clientLeft;
            const clientRight = clientLeft + anc.clientWidth;
            visLeft = Math.max(visLeft, clientLeft);
            visRight = Math.min(visRight, clientRight);
          }
          if (anc === rootEl) break;
          anc = anc.parentElement;
        }

        if (visRight <= visLeft) return;

        if (visRight > maxUnclippedRight) maxUnclippedRight = visRight;
        if (visLeft < minUnclippedLeft) minUnclippedLeft = visLeft;

        const protRight = Math.max(0, visRight - rootRect.right);
        const protLeft = Math.max(0, rootRect.left - visLeft);
        const maxProt = Math.max(protRight, protLeft);
        if (maxProt > worstProtrusion) {
          worstProtrusion = maxProt;
          overflowingDescendant = {
            tag: desc.tagName.toLowerCase(),
            id: desc.getAttribute('data-breakit-id'),
            rect: toBox(dr),
            protrusionRightPx: protRight,
            protrusionLeftPx: protLeft,
          };
        }
      });
    }

    const elements = {};
    for (const id of ids) {
      const el = document.querySelector('[data-breakit-id="' + id + '"]');
      if (!el) {
        elements[id] = {
          exists: false,
          tag: '',
          rect: null,
          textRangeRect: null,
          scrollWidth: 0,
          clientWidth: 0,
          scrollHeight: 0,
          clientHeight: 0,
          normalizedText: '',
          display: 'none',
          visibility: 'hidden',
          effectiveOpacity: 0,
          fontSizePx: 0,
          overflowX: 'visible',
          overflowY: 'visible',
          textOverflow: 'clip',
          whiteSpace: 'normal',
          colorAlpha: 0,
          contrastDelta: 0,
          clippingAncestor: null,
          occludedByTag: null,
        };
        continue;
      }

      const st = window.getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const rangeBox = getTextRangeBox(el);
      const [cr, cg, cb, ca] = parseRgba(st.color);
      const [br, bg, bb] = getEffectiveBackground(el);
      const contrastDelta = Math.hypot(cr - br, cg - bg, cb - bb);

      const elBox = toBox(r);
      const rawBox = rangeBox || elBox;
      const checkTargetBox = {
        x: st.overflowX !== 'visible' ? Math.max(rawBox.x, elBox.x) : rawBox.x,
        right: st.overflowX !== 'visible' ? Math.min(rawBox.right, elBox.right) : rawBox.right,
        y: st.overflowY !== 'visible' ? Math.max(rawBox.y, elBox.y) : rawBox.y,
        bottom: st.overflowY !== 'visible' ? Math.min(rawBox.bottom, elBox.bottom) : rawBox.bottom,
      };
      let clippingAncestor = null;
      let anc = el.parentElement;
      while (anc && anc !== document.body && anc !== document.documentElement) {
        const ast = window.getComputedStyle(anc);
        const ar = anc.getBoundingClientRect();
        const clientLeft = ar.left + anc.clientLeft;
        const clientTop = ar.top + anc.clientTop;
        const clientRight = clientLeft + anc.clientWidth;
        const clientBottom = clientTop + anc.clientHeight;

        const clipH =
          ast.overflowX !== 'visible'
            ? Math.max(0, checkTargetBox.right - clientRight) +
              Math.max(0, clientLeft - checkTargetBox.x)
            : 0;
        const clipV =
          ast.overflowY !== 'visible'
            ? Math.max(0, checkTargetBox.bottom - clientBottom) +
              Math.max(0, clientTop - checkTargetBox.y)
            : 0;

        if (clipH > 0.5 || clipV > 0.5) {
          const prevWorst = clippingAncestor
            ? Math.max(
                clippingAncestor.clippedHorizontallyPx,
                clippingAncestor.clippedVerticallyPx
              )
            : 0;
          if (Math.max(clipH, clipV) > prevWorst) {
            clippingAncestor = {
              tag:
                anc.tagName.toLowerCase() +
                (anc.className && typeof anc.className === 'string'
                  ? '.' + anc.className.trim().split(/\\s+/)[0]
                  : ''),
              rect: toBox(ar),
              clippedHorizontallyPx: clipH,
              clippedVerticallyPx: clipV,
            };
          }
        }
        anc = anc.parentElement;
      }

      let occludedByTag = null;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (
        r.width >= 8 &&
        r.height >= 8 &&
        cx >= 0 &&
        cx <= vpW &&
        cy >= 0 &&
        cy <= vpH &&
        st.display !== 'none' &&
        st.visibility !== 'hidden'
      ) {
        const hit = document.elementFromPoint(cx, cy);
        if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
          occludedByTag = hit.tagName.toLowerCase();
        }
      }

      elements[id] = {
        exists: true,
        tag: el.tagName.toLowerCase(),
        rect: toBox(r),
        textRangeRect: rangeBox,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        normalizedText: (el.textContent || '').replace(/\\s+/g, ' ').trim(),
        display: st.display,
        visibility: st.visibility,
        effectiveOpacity: getEffectiveOpacity(el),
        fontSizePx: parseFloat(st.fontSize || '0') || 0,
        overflowX: st.overflowX,
        overflowY: st.overflowY,
        textOverflow: st.textOverflow,
        whiteSpace: st.whiteSpace,
        colorAlpha: ca,
        contrastDelta,
        clippingAncestor,
        occludedByTag,
      };
    }

    return {
      viewportWidth: vpW,
      viewportHeight: vpH,
      scrollWidth: scrollW,
      scrollHeight: scrollH,
      maxUnclippedRight,
      minUnclippedLeft,
      overflowingDescendant,
      elements,
    };
  })()`;
}

export function aggregateStatus(statuses: VerificationStatus[]): VerificationStatus {
  if (statuses.length === 0) return 'inconclusive';
  if (statuses.includes('error')) return 'error';
  if (statuses.includes('fail')) return 'fail';
  if (statuses.includes('inconclusive')) return 'inconclusive';
  return 'pass';
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function evaluateSingleAssertion(
  rule: AssertionRule,
  inspection: RawPageInspection,
  rootTargetId: string,
  expectedSlotTexts: Record<string, string>,
  slotMap: Map<string, Pick<TextSlot, 'id' | 'originalText'>>
): AssertionResult {
  const tol = Number.isFinite(rule.tolerancePx) ? Math.max(0, rule.tolerancePx) : 1.5;
  const containerId = rule.containerId || rootTargetId;
  const containerInfo = inspection.elements[containerId];
  const containerRect = containerInfo?.rect || null;

  if (rule.type === 'no_viewport_overflow') {
    const docOverflowPx = round1(inspection.scrollWidth - inspection.viewportWidth);
    const rootRightOverflowPx = containerRect
      ? round1(containerRect.right - inspection.viewportWidth)
      : 0;
    const rootLeftOverflowPx = containerRect ? round1(0 - containerRect.x) : 0;
    const descRightProtrusion = inspection.overflowingDescendant?.protrusionRightPx ?? 0;
    const descLeftProtrusion = inspection.overflowingDescendant?.protrusionLeftPx ?? 0;

    const worstOverflow = Math.max(
      docOverflowPx,
      rootRightOverflowPx,
      rootLeftOverflowPx,
      descRightProtrusion,
      descLeftProtrusion
    );

    if (!containerInfo?.exists || !containerRect || containerRect.width < 4 || containerRect.height < 4) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        status: 'fail',
        summary: `Root component container [${containerId}] is hidden or collapsed (${containerRect ? `${round1(containerRect.width)}×${round1(containerRect.height)}px` : 'missing'}).`,
        measurements: {
          viewportWidth: inspection.viewportWidth,
          viewportHeight: inspection.viewportHeight,
          scrollWidth: inspection.scrollWidth,
          scrollHeight: inspection.scrollHeight,
          containerRect,
        },
        highlightBoxes: [],
      };
    }

    if (worstOverflow > tol) {
      const highlights: HighlightBox[] = [
        { label: `Card (${round1(containerRect.width)}px)`, role: 'container', rect: containerRect },
      ];
      let detail = `Document scrollWidth (${round1(inspection.scrollWidth)}px) exceeds ${inspection.viewportWidth}px viewport by ${docOverflowPx}px`;
      if (
        inspection.overflowingDescendant &&
        (descRightProtrusion > tol || descLeftProtrusion > tol)
      ) {
        highlights.push({
          label: `Overflow (${inspection.overflowingDescendant.id || inspection.overflowingDescendant.tag})`,
          role: 'overflow',
          rect: inspection.overflowingDescendant.rect,
        });
        const spill = round1(Math.max(descRightProtrusion, descLeftProtrusion));
        detail = `Element <${inspection.overflowingDescendant.tag}> spills outside card bounds by ${spill}px (scrollWidth: ${round1(inspection.scrollWidth)}px, viewport: ${inspection.viewportWidth}px)`;
      }

      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        status: 'fail',
        summary: `${detail} (tolerance: ${tol}px).`,
        measurements: {
          viewportWidth: inspection.viewportWidth,
          viewportHeight: inspection.viewportHeight,
          scrollWidth: inspection.scrollWidth,
          scrollHeight: inspection.scrollHeight,
          overflowPx: round1(worstOverflow),
          containerRect,
          targetRect: inspection.overflowingDescendant?.rect ?? null,
        },
        highlightBoxes: highlights,
      };
    }

    return {
      assertionId: rule.id,
      assertionLabel: rule.label,
      assertionType: rule.type,
      status: 'pass',
      summary: `Fits cleanly within ${inspection.viewportWidth}px viewport and card container (scrollWidth: ${round1(inspection.scrollWidth)}px).`,
      measurements: {
        viewportWidth: inspection.viewportWidth,
        viewportHeight: inspection.viewportHeight,
        scrollWidth: inspection.scrollWidth,
        scrollHeight: inspection.scrollHeight,
        overflowPx: Math.max(0, round1(worstOverflow)),
        containerRect,
      },
      highlightBoxes: [{ label: 'Card container', role: 'container', rect: containerRect }],
    };
  }

  if (rule.type === 'cta_visible_in_bounds') {
    const targetId = rule.targetId || '';
    const target = inspection.elements[targetId];
    if (!target || !target.exists) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `Required CTA [${targetId}] is missing from the rendered DOM.`,
        measurements: { viewportWidth: inspection.viewportWidth, containerRect },
        highlightBoxes: containerRect
          ? [{ label: 'Card container', role: 'container', rect: containerRect }]
          : [],
      };
    }

    const expectedText = expectedSlotTexts[targetId];
    if (
      target.display === 'none' ||
      target.visibility === 'hidden' ||
      target.visibility === 'collapse' ||
      target.effectiveOpacity < 0.15 ||
      target.fontSizePx < 9 ||
      target.colorAlpha < 0.15 ||
      target.contrastDelta < 12
    ) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `CTA [${targetId}] is visually hidden or suppressed (display: ${target.display}, visibility: ${target.visibility}, opacity: ${round1(target.effectiveOpacity)}, font-size: ${round1(target.fontSizePx)}px).`,
        measurements: {
          targetRect: target.rect,
          containerRect,
          computedDisplay: target.display,
          computedVisibility: target.visibility,
          computedOpacity: target.effectiveOpacity,
          computedFontSizePx: target.fontSizePx,
        },
        highlightBoxes: [
          ...(containerRect ? [{ label: 'Card', role: 'container' as const, rect: containerRect }] : []),
          ...(target.rect ? [{ label: 'Hidden CTA', role: 'target' as const, rect: target.rect }] : []),
        ],
      };
    }

    if (expectedText && target.normalizedText !== expectedText) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `CTA [${targetId}] content was altered or removed (expected "${expectedText}", rendered "${target.normalizedText}").`,
        measurements: {
          targetRect: target.rect,
          containerRect,
          renderedTextLength: target.normalizedText.length,
          expectedTextLength: expectedText.length,
        },
        highlightBoxes: target.rect
          ? [{ label: 'CTA', role: 'target', rect: target.rect }]
          : [],
      };
    }

    const rect = target.rect;
    if (!rect || rect.width < 24 || rect.height < 16) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `CTA [${targetId}] has unusable dimensions (${rect ? `${round1(rect.width)}×${round1(rect.height)}px` : '0×0px'}).`,
        measurements: { targetRect: rect, containerRect },
        highlightBoxes: rect ? [{ label: 'Collapsed CTA', role: 'target', rect }] : [],
      };
    }

    const failures: string[] = [];
    const highlights: HighlightBox[] = [
      { label: `CTA (${round1(rect.width)}×${round1(rect.height)}px)`, role: 'target', rect },
    ];
    if (containerRect) {
      highlights.unshift({ label: 'Card bounds', role: 'container', rect: containerRect });
      if (rect.right > containerRect.right + tol) {
        failures.push(`overflows card right edge by ${round1(rect.right - containerRect.right)}px`);
      }
      if (rect.x < containerRect.x - tol) {
        failures.push(`overflows card left edge by ${round1(containerRect.x - rect.x)}px`);
      }
      if (rect.bottom > containerRect.bottom + tol) {
        failures.push(`overflows card bottom edge by ${round1(rect.bottom - containerRect.bottom)}px`);
      }
      if (rect.y < containerRect.y - tol) {
        failures.push(`overflows card top edge by ${round1(containerRect.y - rect.y)}px`);
      }
    }

    if (rect.right > inspection.viewportWidth + tol || rect.x < 0 - tol) {
      const vpSpill = Math.max(rect.right - inspection.viewportWidth, 0 - rect.x);
      failures.push(`extends outside ${inspection.viewportWidth}px viewport by ${round1(vpSpill)}px`);
    }

    if (target.clippingAncestor) {
      const clipPx = Math.max(
        target.clippingAncestor.clippedHorizontallyPx,
        target.clippingAncestor.clippedVerticallyPx
      );
      if (clipPx > tol) {
        failures.push(
          `clipped ${round1(clipPx)}px by ancestor <${target.clippingAncestor.tag}>`
        );
        highlights.push({
          label: `Clip (<${target.clippingAncestor.tag}>)`,
          role: 'clip',
          rect: target.clippingAncestor.rect,
        });
      }
    }

    const innerHorizClip =
      target.overflowX !== 'visible' ? target.scrollWidth - target.clientWidth : 0;
    const innerVertClip =
      target.overflowY !== 'visible' ? target.scrollHeight - target.clientHeight : 0;
    if (innerHorizClip > tol || innerVertClip > tol) {
      failures.push(
        `CTA label clipped internally (${round1(Math.max(innerHorizClip, innerVertClip))}px)`
      );
    }

    if (target.occludedByTag) {
      failures.push(`center hit-test occluded by <${target.occludedByTag}>`);
    }

    if (failures.length > 0) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `CTA [${targetId}] ${failures.join('; ')}.`,
        measurements: {
          viewportWidth: inspection.viewportWidth,
          targetRect: rect,
          containerRect,
          clippingAncestorTag: target.clippingAncestor?.tag ?? null,
          clippingAncestorRect: target.clippingAncestor?.rect ?? null,
          occludedByTag: target.occludedByTag,
          horizontalClipPx: round1(Math.max(0, innerHorizClip)),
          verticalClipPx: round1(Math.max(0, innerVertClip)),
        },
        highlightBoxes: highlights,
      };
    }

    return {
      assertionId: rule.id,
      assertionLabel: rule.label,
      assertionType: rule.type,
      targetId,
      status: 'pass',
      summary: `CTA [${targetId}] is visible, unoccluded, and fully within card & viewport (${round1(rect.width)}×${round1(rect.height)}px).`,
      measurements: {
        viewportWidth: inspection.viewportWidth,
        targetRect: rect,
        containerRect,
      },
      highlightBoxes: highlights,
    };
  }

  if (rule.type === 'text_not_clipped') {
    const targetId = rule.targetId || '';
    const target = inspection.elements[targetId];
    const slotMeta = slotMap.get(targetId);

    if (!target || !target.exists) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `Required text slot [${targetId}] is missing from the DOM.`,
        measurements: { containerRect },
        highlightBoxes: [],
      };
    }

    const expectedText = expectedSlotTexts[targetId] ?? slotMeta?.originalText ?? '';

    if (
      target.display === 'none' ||
      target.visibility === 'hidden' ||
      target.visibility === 'collapse' ||
      target.effectiveOpacity < 0.15 ||
      target.fontSizePx < 8 ||
      target.colorAlpha < 0.15 ||
      target.contrastDelta < 12
    ) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `Text slot [${targetId}] was hidden or made unreadable (display: ${target.display}, visibility: ${target.visibility}, opacity: ${round1(target.effectiveOpacity)}, font-size: ${round1(target.fontSizePx)}px).`,
        measurements: {
          targetRect: target.rect,
          containerRect,
          computedDisplay: target.display,
          computedVisibility: target.visibility,
          computedOpacity: target.effectiveOpacity,
          computedFontSizePx: target.fontSizePx,
        },
        highlightBoxes: target.rect
          ? [{ label: `Hidden (${targetId})`, role: 'target', rect: target.rect }]
          : [],
      };
    }

    if (expectedText && target.normalizedText !== expectedText) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `Text slot [${targetId}] lost required text content (expected ${expectedText.length} chars, got ${target.normalizedText.length}).`,
        measurements: {
          targetRect: target.rect,
          renderedTextLength: target.normalizedText.length,
          expectedTextLength: expectedText.length,
        },
        highlightBoxes: target.rect
          ? [{ label: targetId, role: 'target', rect: target.rect }]
          : [],
      };
    }

    const rect = target.rect;
    const rangeRect = target.textRangeRect || rect;
    if (!rect || rect.width < 2 || rect.height < 2 || !rangeRect) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `Text slot [${targetId}] collapsed to zero-area bounds.`,
        measurements: { targetRect: rect, containerRect },
        highlightBoxes: [],
      };
    }

    const selfHorizClip =
      target.overflowX !== 'visible' ? Math.max(0, target.scrollWidth - target.clientWidth) : 0;
    const selfVertClip =
      target.overflowY !== 'visible' ? Math.max(0, target.scrollHeight - target.clientHeight) : 0;

    const ancHorizClip = target.clippingAncestor?.clippedHorizontallyPx ?? 0;
    const ancVertClip = target.clippingAncestor?.clippedVerticallyPx ?? 0;

    const paintedLeft =
      target.overflowX !== 'visible' ? Math.max(rangeRect.x, rect.x) : rangeRect.x;
    const paintedRight =
      target.overflowX !== 'visible' ? Math.min(rangeRect.right, rect.right) : rangeRect.right;
    const paintedBottom =
      target.overflowY !== 'visible' ? Math.min(rangeRect.bottom, rect.bottom) : rangeRect.bottom;

    const cardRightSpill = containerRect ? Math.max(0, paintedRight - containerRect.right) : 0;
    const cardLeftSpill = containerRect ? Math.max(0, containerRect.x - paintedLeft) : 0;
    const cardBottomSpill = containerRect ? Math.max(0, paintedBottom - containerRect.bottom) : 0;
    const vpRightSpill = Math.max(0, paintedRight - inspection.viewportWidth);

    const allowEllipsis = Boolean(rule.exception?.allowEllipsis);
    const hasIntentionalEllipsisStyle =
      target.textOverflow === 'ellipsis' &&
      target.overflowX === 'hidden' &&
      target.whiteSpace === 'nowrap';

    const effectiveSelfHorizClip =
      allowEllipsis && hasIntentionalEllipsisStyle ? 0 : selfHorizClip;

    const totalHorizIssue = Math.max(
      effectiveSelfHorizClip,
      ancHorizClip,
      cardRightSpill,
      cardLeftSpill,
      vpRightSpill
    );
    const totalVertIssue = Math.max(selfVertClip, ancVertClip, cardBottomSpill);

    const highlightTargetRect =
      target.overflowX !== 'visible' || target.overflowY !== 'visible' ? rect : rangeRect;
    const highlights: HighlightBox[] = [
      { label: targetId, role: 'target', rect: highlightTargetRect },
    ];
    if (containerRect) {
      highlights.unshift({ label: 'Card', role: 'container', rect: containerRect });
    }

    const reasons: string[] = [];
    if (effectiveSelfHorizClip > tol) {
      reasons.push(
        `horizontally clipped ${round1(effectiveSelfHorizClip)}px inside its own box (scrollWidth ${round1(target.scrollWidth)}px > clientWidth ${round1(target.clientWidth)}px)`
      );
    }
    if (selfVertClip > tol) {
      reasons.push(
        `vertically clipped ${round1(selfVertClip)}px inside its own box (scrollHeight ${round1(target.scrollHeight)}px > clientHeight ${round1(target.clientHeight)}px)`
      );
    }
    if (ancHorizClip > tol && target.clippingAncestor) {
      reasons.push(
        `horizontally clipped ${round1(ancHorizClip)}px by ancestor <${target.clippingAncestor.tag}>`
      );
      highlights.push({
        label: `Clip (<${target.clippingAncestor.tag}>)`,
        role: 'clip',
        rect: target.clippingAncestor.rect,
      });
    }
    if (ancVertClip > tol && target.clippingAncestor) {
      reasons.push(
        `vertically clipped ${round1(ancVertClip)}px by ancestor <${target.clippingAncestor.tag}>`
      );
      highlights.push({
        label: `Clip (<${target.clippingAncestor.tag}>)`,
        role: 'clip',
        rect: target.clippingAncestor.rect,
      });
    }
    if (cardRightSpill > tol || cardLeftSpill > tol) {
      const spill = round1(Math.max(cardRightSpill, cardLeftSpill));
      reasons.push(`text glyphs overflow card horizontal border by ${spill}px`);
    }
    if (cardBottomSpill > tol) {
      reasons.push(`text glyphs overflow card bottom border by ${round1(cardBottomSpill)}px`);
    }
    if (vpRightSpill > tol) {
      reasons.push(`text extends ${round1(vpRightSpill)}px past ${inspection.viewportWidth}px viewport`);
    }

    if (reasons.length > 0) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId,
        status: 'fail',
        summary: `Slot [${targetId}] ${reasons.join('; ')}.`,
        measurements: {
          viewportWidth: inspection.viewportWidth,
          targetRect: rect,
          textRangeRect: rangeRect,
          containerRect,
          horizontalClipPx: round1(totalHorizIssue),
          verticalClipPx: round1(totalVertIssue),
          clippingAncestorTag: target.clippingAncestor?.tag ?? null,
          clippingAncestorRect: target.clippingAncestor?.rect ?? null,
          computedOverflowX: target.overflowX,
          computedOverflowY: target.overflowY,
          computedTextOverflow: target.textOverflow,
        },
        highlightBoxes: highlights,
      };
    }

    const ellipsisNote =
      allowEllipsis && hasIntentionalEllipsisStyle && selfHorizClip > tol
        ? ' (with user-approved ellipsis exception)'
        : '';

    return {
      assertionId: rule.id,
      assertionLabel: rule.label,
      assertionType: rule.type,
      targetId,
      status: 'pass',
      summary: `Slot [${targetId}] renders completely unclipped inside card bounds${ellipsisNote}.`,
      measurements: {
        viewportWidth: inspection.viewportWidth,
        targetRect: rect,
        textRangeRect: rangeRect,
        containerRect,
        horizontalClipPx: 0,
        verticalClipPx: 0,
      },
      highlightBoxes: highlights,
    };
  }

  if (rule.type === 'controls_separated') {
    const aId = rule.targetId || '';
    const bId = rule.secondaryTargetId || '';
    const a = inspection.elements[aId];
    const b = inspection.elements[bId];

    if (
      !a?.exists ||
      !a.rect ||
      a.display === 'none' ||
      a.visibility === 'hidden' ||
      a.effectiveOpacity < 0.15 ||
      !b?.exists ||
      !b.rect ||
      b.display === 'none' ||
      b.visibility === 'hidden' ||
      b.effectiveOpacity < 0.15
    ) {
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId: aId,
        status: 'fail',
        summary: `Interactive control(s) [${aId}, ${bId}] missing or hidden.`,
        measurements: {
          targetRect: a?.rect ?? null,
          secondaryRect: b?.rect ?? null,
        },
        highlightBoxes: [],
      };
    }

    const ar = a.rect;
    const br = b.rect;
    const overlapsHoriz = ar.x < br.right && ar.right > br.x;
    const overlapsVert = ar.y < br.bottom && ar.bottom > br.y;

    let gapPx: number;
    if (overlapsHoriz && overlapsVert) {
      const overlapX = Math.min(ar.right, br.right) - Math.max(ar.x, br.x);
      const overlapY = Math.min(ar.bottom, br.bottom) - Math.max(ar.y, br.y);
      gapPx = -Math.min(overlapX, overlapY);
    } else {
      const dx = Math.max(0, Math.max(ar.x - br.right, br.x - ar.right));
      const dy = Math.max(0, Math.max(ar.y - br.bottom, br.y - ar.bottom));
      gapPx = Math.hypot(dx, dy);
    }

    const minGap = rule.minGapPx ?? 4;
    const highlights: HighlightBox[] = [
      { label: aId, role: 'target', rect: ar },
      { label: bId, role: 'secondary', rect: br },
    ];

    if (!rule.exception?.allowOverlap && gapPx < minGap - tol) {
      const desc =
        gapPx < 0
          ? `overlap by ${round1(Math.abs(gapPx))}px`
          : `only ${round1(gapPx)}px apart (minimum ${minGap}px)`;
      return {
        assertionId: rule.id,
        assertionLabel: rule.label,
        assertionType: rule.type,
        targetId: aId,
        status: 'fail',
        summary: `Controls [${bId}] and [${aId}] ${desc}.`,
        measurements: {
          gapPx: round1(gapPx),
          targetRect: ar,
          secondaryRect: br,
        },
        highlightBoxes: highlights,
      };
    }

    return {
      assertionId: rule.id,
      assertionLabel: rule.label,
      assertionType: rule.type,
      targetId: aId,
      status: 'pass',
      summary: `Controls [${bId}] and [${aId}] maintain ${round1(gapPx)}px separation${
        rule.exception?.allowOverlap && gapPx < minGap - tol ? ' (with user-approved overlap exception)' : ''
      }.`,
      measurements: {
        gapPx: round1(gapPx),
        targetRect: ar,
        secondaryRect: br,
      },
      highlightBoxes: highlights,
    };
  }

  return {
    assertionId: rule.id,
    assertionLabel: rule.label,
    assertionType: rule.type,
    status: 'inconclusive',
    summary: `Unsupported assertion type "${String(rule.type)}" — never treated as pass.`,
    measurements: {},
    highlightBoxes: [],
  };
}
