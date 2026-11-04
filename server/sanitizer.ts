import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';
import type {
  AssertionRule,
  InteractiveTarget,
  SanitizationReport,
  SlotMutation,
  SlotRole,
  TextSlot,
} from '../src/shared/types.js';

export const MAX_HTML_BYTES = 64 * 1024;
export const MAX_CSS_BYTES = 64 * 1024;
export const MAX_MUTATION_LENGTH = 280;

const FORBIDDEN_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'noscript',
  'portal',
]);

const URL_ATTRIBUTES = new Set([
  'src',
  'href',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'data',
  'ping',
  'srcset',
]);

const PLACEHOLDER_SVG_DATA_URI =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64" viewBox="0 0 96 64"><rect width="96" height="64" rx="8" fill="#e2e8f0"/><path d="M26 44l14-16 12 13 8-9 10 12H26z" fill="#94a3b8"/><circle cx="36" cy="22" r="5" fill="#94a3b8"/></svg>'
  );

export interface ComponentAnalysisResult {
  sanitizedHtml: string;
  instrumentedHtml: string;
  sanitizedCss: string;
  rootTargetId: string;
  slots: TextSlot[];
  interactiveTargets: InteractiveTarget[];
  suggestedAssertions: AssertionRule[];
  sanitization: SanitizationReport;
}

export function sanitizeCssInput(
  rawCss: string,
  report: SanitizationReport
): string {
  if (Buffer.byteLength(rawCss, 'utf8') > MAX_CSS_BYTES) {
    throw new Error(`CSS exceeds maximum size limit of ${MAX_CSS_BYTES} bytes.`);
  }

  let css = rawCss;

  // Strip @import rules completely so external stylesheets can never be fetched
  css = css.replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;?/gi, (match) => {
    report.strippedCssConstructs.push(`@import: ${match.slice(0, 80)}`);
    return '/* stripped @import */';
  });

  // Strip legacy active CSS vectors
  css = css.replace(/expression\s*\([^)]*\)/gi, (match) => {
    report.strippedCssConstructs.push(`expression(): ${match.slice(0, 60)}`);
    return 'none';
  });
  css = css.replace(/(?:-moz-binding|behavior)\s*:[^;]+;?/gi, (match) => {
    report.strippedCssConstructs.push(match.slice(0, 60));
    return '';
  });

  // Inspect url(...) tokens and neutralize any non-data:image / non-data:font external or file URLs
  css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _quote, rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (/^data:(?:image|font)\//i.test(trimmed) && trimmed.length < 32768) {
      return full;
    }
    if (trimmed.startsWith('#')) {
      return full;
    }
    report.strippedExternalUrls.push(trimmed.slice(0, 140));
    report.strippedCssConstructs.push(`external url(${trimmed.slice(0, 80)})`);
    return 'none';
  });

  return css;
}

function inferSlotRole(tagName: string, classAttr: string, text: string): SlotRole {
  const cls = classAttr.toLowerCase();
  if (tagName === 'button' || tagName === 'a' || cls.includes('cta') || cls.includes('btn')) {
    return 'cta';
  }
  if (/^h[1-6]$/.test(tagName) || cls.includes('name') || cls.includes('title')) {
    return 'heading';
  }
  if (tagName === 'code' || cls.includes('code') || cls.includes('ref') || cls.includes('hash')) {
    return 'code';
  }
  if (cls.includes('price') || cls.includes('amount') || /^\s*[$€£¥]/.test(text)) {
    return 'price';
  }
  if (cls.includes('pill') || cls.includes('badge') || cls.includes('tag') || cls.includes('eyebrow')) {
    return 'badge';
  }
  if (cls.includes('label') || cls.includes('meta')) {
    return 'meta';
  }
  return 'text';
}

function hasDirectMeaningfulText(el: Element): boolean {
  for (const child of el.children) {
    if (child.type === 'text' && child.data.trim().length > 0) {
      return true;
    }
  }
  return false;
}

function isInteractiveElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag === 'button' || tag === 'a') return true;
  const role = (el.attribs?.role || '').toLowerCase();
  if (role === 'button' || role === 'link') return true;
  if (tag === 'input') {
    const t = (el.attribs?.type || '').toLowerCase();
    return t === 'submit' || t === 'button';
  }
  return false;
}

const CANDIDATE_TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'span',
  'strong',
  'b',
  'em',
  'code',
  'label',
  'dd',
  'dt',
  'li',
  'button',
  'a',
  'div',
]);

function makeSelectorHint(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = (el.attribs?.class || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (cls.length > 0) {
    return `${tag}.${cls.join('.')}`;
  }
  if (el.attribs?.id) {
    return `${tag}#${el.attribs.id}`;
  }
  return tag;
}

export function analyzeAndSanitizeComponent(
  rawHtml: string,
  rawCss: string
): ComponentAnalysisResult {
  if (Buffer.byteLength(rawHtml, 'utf8') > MAX_HTML_BYTES) {
    throw new Error(`HTML exceeds maximum size limit of ${MAX_HTML_BYTES} bytes.`);
  }
  if (!rawHtml.trim()) {
    throw new Error('Component HTML cannot be empty.');
  }

  const report: SanitizationReport = {
    strippedTags: [],
    strippedAttributes: [],
    strippedExternalUrls: [],
    strippedCssConstructs: [],
    warnings: [],
  };

  const sanitizedCss = sanitizeCssInput(rawCss, report);

  const $ = cheerio.load(rawHtml, { xmlMode: false }, false);

  // Extract any inline <style> blocks into CSS consideration? Better: sanitize inline <style> or strip <script>/forbidden tags
  $('*').each((_idx, node) => {
    if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();

    if (FORBIDDEN_TAGS.has(tag)) {
      report.strippedTags.push(`<${tag}>`);
      $(el).remove();
      return;
    }

    if (tag === 'style') {
      const innerCss = $(el).text();
      $(el).text(sanitizeCssInput(innerCss, report));
      return;
    }

    const attribs = { ...el.attribs };
    for (const [attrName, attrVal] of Object.entries(attribs)) {
      const lowerAttr = attrName.toLowerCase();

      if (lowerAttr.startsWith('on') || lowerAttr === 'srcdoc') {
        report.strippedAttributes.push(`${tag}[${lowerAttr}]`);
        $(el).removeAttr(attrName);
        continue;
      }

      if (lowerAttr === 'style') {
        $(el).attr(attrName, sanitizeCssInput(attrVal, report));
        continue;
      }

      if (URL_ATTRIBUTES.has(lowerAttr)) {
        const trimmedVal = (attrVal || '').trim();
        if (/^(?:javascript|vbscript|file|data:(?!image\/))/i.test(trimmedVal)) {
          report.strippedAttributes.push(`${tag}[${lowerAttr}=${trimmedVal.slice(0, 32)}]`);
          report.strippedExternalUrls.push(trimmedVal.slice(0, 140));
          if (tag === 'a') {
            $(el).attr('href', '#');
          } else {
            $(el).removeAttr(attrName);
          }
          continue;
        }

        if (
          /^(?:https?:)?\/\//i.test(trimmedVal) ||
          (lowerAttr === 'srcset' && trimmedVal.length > 0)
        ) {
          report.strippedExternalUrls.push(trimmedVal.slice(0, 140));
          if (tag === 'img' && lowerAttr === 'src') {
            $(el).attr('src', PLACEHOLDER_SVG_DATA_URI);
          } else if (tag === 'a' && lowerAttr === 'href') {
            $(el).attr('href', '#');
          } else {
            $(el).removeAttr(attrName);
          }
        }
      }

      if (tag === 'a' && lowerAttr === 'target') {
        $(el).removeAttr('target');
      }
    }
  });

  const sanitizedHtml = $.html().trim();

  // Re-load clean fragment to assign deterministic data-breakit-id markers
  const $inst = cheerio.load(sanitizedHtml, { xmlMode: false }, false);
  const topElements = $inst
    .root()
    .children()
    .toArray()
    .filter((n): n is Element => n.type === 'tag' && (n as Element).tagName.toLowerCase() !== 'style');

  if (topElements.length === 0) {
    throw new Error('No renderable HTML element remained after sanitization.');
  }

  let rootEl: Element;
  if (topElements.length === 1) {
    rootEl = topElements[0];
  } else {
    $inst.root().wrapInner('<div class="breakit-auto-root" data-breakit-id="card-root"></div>');
    rootEl = $inst('[data-breakit-id="card-root"]').get(0) as Element;
  }

  const usedIds = new Set<string>();
  const ensureValidId = (preferred: string): string => {
    const clean = preferred.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'slot';
    if (!usedIds.has(clean)) {
      usedIds.add(clean);
      return clean;
    }
    let counter = 2;
    while (usedIds.has(`${clean}-${counter}`)) {
      counter += 1;
    }
    const next = `${clean}-${counter}`;
    usedIds.add(next);
    return next;
  };

  const existingRootId = $inst(rootEl).attr('data-breakit-id');
  const rootTargetId = ensureValidId(existingRootId || 'card-root');
  $inst(rootEl).attr('data-breakit-id', rootTargetId);

  const slots: TextSlot[] = [];
  const interactiveTargets: InteractiveTarget[] = [];
  let autoSlotIndex = 1;

  const walk = (node: AnyNode) => {
    if (node.type !== 'tag') return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'style' || tag === 'svg') return;

    const existingId = $inst(el).attr('data-breakit-id');
    const isRoot = el === rootEl;
    const interactive = isInteractiveElement(el);
    const fullText = $inst(el).text().replace(/\s+/g, ' ').trim();
    const childTags = el.children.filter((c): c is Element => c.type === 'tag');
    const isLeafLike =
      childTags.length === 0 ||
      (hasDirectMeaningfulText(el) &&
        childTags.every((c) => ['br', 'wbr', 'svg', 'img'].includes(c.tagName.toLowerCase())));

    const shouldRegisterSlot =
      !isRoot &&
      fullText.length > 0 &&
      (Boolean(existingId) ||
        interactive ||
        (CANDIDATE_TEXT_TAGS.has(tag) && isLeafLike));

    if (shouldRegisterSlot) {
      const assignedId = existingId
        ? ensureValidId(existingId)
        : ensureValidId(`slot-${tag}-${autoSlotIndex++}`);
      $inst(el).attr('data-breakit-id', assignedId);

      const classAttr = el.attribs?.class || '';
      const role = inferSlotRole(tag, classAttr, fullText);
      const selectorHint = makeSelectorHint(el);
      const label = `${selectorHint} ("${fullText.slice(0, 26)}${fullText.length > 26 ? '…' : ''}")`;

      // Static field labels like "Referencia" / "Método" can be marked non-required for mutation focus,
      // while headings, prices, codes, badges, notes, and CTAs are required by default.
      const required = role !== 'meta';

      slots.push({
        id: assignedId,
        label,
        tagName: tag,
        role,
        originalText: fullText,
        required,
        selectorHint,
      });

      if (interactive) {
        interactiveTargets.push({
          id: assignedId,
          label,
          tagName: tag,
          text: fullText,
        });
      }
      // Do not descend inside registered leaf/interactive slots
      return;
    }

    for (const child of el.children) {
      walk(child);
    }
  };

  walk(rootEl);

  const instrumentedHtml = $inst.html().trim();

  // Build sensible, explicit default assertions
  const suggestedAssertions: AssertionRule[] = [
    {
      id: 'assert-no-viewport-overflow',
      type: 'no_viewport_overflow',
      label: 'No horizontal viewport or card overflow',
      enabled: true,
      tolerancePx: 1.5,
      containerId: rootTargetId,
    },
  ];

  if (interactiveTargets.length > 0) {
    // Prefer primary CTA (avoiding 'secondary' / 'cancel' / 'hold' buttons when a primary action exists)
    const primaryTarget =
      interactiveTargets.find(
        (t) =>
          !/secondary|cancel|hold|back/i.test(t.id + ' ' + t.label) &&
          /primary|cta|approve|submit|pay|confirm|enviar|autorizar/i.test(t.id + ' ' + t.label)
      ) || interactiveTargets[interactiveTargets.length - 1];

    suggestedAssertions.push({
      id: `assert-cta-${primaryTarget.id}`,
      type: 'cta_visible_in_bounds',
      label: `Primary CTA (${primaryTarget.text}) visible & inside card`,
      enabled: true,
      tolerancePx: 1.5,
      targetId: primaryTarget.id,
      containerId: rootTargetId,
    });

    if (interactiveTargets.length >= 2) {
      const secondaryTarget =
        interactiveTargets.find((t) => t.id !== primaryTarget.id) || interactiveTargets[0];
      suggestedAssertions.push({
        id: `assert-controls-separated-${secondaryTarget.id}-${primaryTarget.id}`,
        type: 'controls_separated',
        label: `Interactive controls remain separated (${secondaryTarget.text} ↔ ${primaryTarget.text})`,
        enabled: true,
        tolerancePx: 1.0,
        minGapPx: 4,
        targetId: primaryTarget.id,
        secondaryTargetId: secondaryTarget.id,
      });
    }
  }

  // Add text_not_clipped assertions for required content slots (headings, notes, codes, prices, CTAs)
  for (const slot of slots) {
    if (!slot.required) continue;
    suggestedAssertions.push({
      id: `assert-unclipped-${slot.id}`,
      type: 'text_not_clipped',
      label: `Text slot unclipped & visible: ${slot.selectorHint}`,
      enabled: true,
      tolerancePx: 2.0,
      targetId: slot.id,
      containerId: rootTargetId,
      exception: {
        allowEllipsis: false,
      },
    });
  }

  return {
    sanitizedHtml,
    instrumentedHtml,
    sanitizedCss,
    rootTargetId,
    slots,
    interactiveTargets,
    suggestedAssertions,
    sanitization: report,
  };
}

export function applyValidatedSlotMutations(
  instrumentedHtml: string,
  validSlots: TextSlot[],
  mutations: SlotMutation[]
): { mutatedHtml: string; appliedMutations: SlotMutation[]; expectedSlotTexts: Record<string, string> } {
  const slotMap = new Map(validSlots.map((s) => [s.id, s]));
  const expectedSlotTexts: Record<string, string> = {};
  for (const s of validSlots) {
    expectedSlotTexts[s.id] = s.originalText;
  }

  const $ = cheerio.load(instrumentedHtml, { xmlMode: false }, false);
  const appliedMutations: SlotMutation[] = [];

  for (const mut of mutations) {
    const slot = slotMap.get(mut.slotId);
    if (!slot) {
      throw new Error(`Invalid mutation target slotId "${mut.slotId}".`);
    }
    const cleanValue = String(mut.value ?? '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .slice(0, MAX_MUTATION_LENGTH);

    if (cleanValue.trim().length === 0) {
      throw new Error(`Mutation for slot "${mut.slotId}" cannot empty out required text.`);
    }

    const target = $(`[data-breakit-id="${mut.slotId}"]`);
    if (target.length === 0) {
      throw new Error(`Target element [data-breakit-id="${mut.slotId}"] not found in instrumented HTML.`);
    }

    // Strictly replace textContent — never innerHTML
    target.first().text(cleanValue);
    const normalizedExpected = cleanValue.replace(/\s+/g, ' ').trim();
    expectedSlotTexts[mut.slotId] = normalizedExpected;
    appliedMutations.push({ slotId: mut.slotId, value: cleanValue });
  }

  return {
    mutatedHtml: $.html(),
    appliedMutations,
    expectedSlotTexts,
  };
}
