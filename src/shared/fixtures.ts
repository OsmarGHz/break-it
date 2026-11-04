import type { StressScenario } from './types.js';

export interface BundledFixture {
  id: string;
  name: string;
  tagline: string;
  description: string;
  html: string;
  css: string;
  /** Only populated on internal verification fixtures, never disguised as a model response */
  referenceCorrectedCss?: string;
  starterScenarios: StressScenario[];
}

export const CHECKOUT_FRAGILE_HTML = `<article class="checkout-card" data-breakit-id="card-root">
  <header class="card-header">
    <div class="customer-block">
      <span class="eyebrow" data-breakit-id="slot-eyebrow">Resumen de cobro</span>
      <h2 class="customer-name" data-breakit-id="slot-customer">Sofía Vega</h2>
    </div>
    <span class="status-pill" data-breakit-id="slot-badge">Verificado</span>
  </header>

  <div class="plan-box">
    <div class="plan-row">
      <strong class="plan-title" data-breakit-id="slot-plan">Plan Estudio Anual</strong>
      <span class="plan-price" data-breakit-id="slot-price">$49.00 USD</span>
    </div>
    <p class="plan-note" data-breakit-id="slot-note">Renovación automática cada 12 meses con factura fiscal incluida.</p>
  </div>

  <div class="meta-grid">
    <div class="meta-cell">
      <span class="meta-label">Referencia</span>
      <code class="order-ref" data-breakit-id="slot-ref">ORD-9042-MX</code>
    </div>
    <div class="meta-cell">
      <span class="meta-label">Método</span>
      <span class="payment-method" data-breakit-id="slot-method">Visa •••• 4821</span>
    </div>
  </div>

  <footer class="action-bar">
    <button type="button" class="secondary-btn" data-breakit-id="slot-secondary-cta">Cambiar</button>
    <button type="button" class="primary-cta" data-breakit-id="slot-primary-cta">Confirmar pago</button>
  </footer>
</article>`;

/**
 * Intentionally realistic fragile CSS:
 * 1) .customer-name has white-space: nowrap and .customer-block lacks min-width: 0 -> long compound names overflow card & push badge out.
 * 2) .plan-box has fixed height: 74px and overflow: hidden -> multi-line localized notes clip vertically.
 * 3) .order-ref in CSS grid cell lacks min-width: 0 and overflow-wrap: anywhere -> unbroken transaction IDs blow out horizontal width.
 * 4) .action-bar is rigid single-row flex with nowrap buttons -> on 320px narrow screens or longer localized CTA labels, the primary CTA overflows the card container.
 */
export const CHECKOUT_FRAGILE_CSS = `.checkout-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  padding: 22px;
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid #dfe3ec;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
  color: #0f172a;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin-bottom: 4px;
}

.customer-name {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.25;
  white-space: nowrap;
  color: #0f172a;
}

.status-pill {
  flex-shrink: 0;
  padding: 5px 10px;
  border-radius: 999px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #047857;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.plan-box {
  box-sizing: border-box;
  height: 76px;
  overflow: hidden;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  margin-bottom: 16px;
}

.plan-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}

.plan-title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  white-space: nowrap;
}

.plan-price {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  white-space: nowrap;
}

.plan-note {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.4;
  color: #475569;
}

.meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 18px;
}

.meta-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
}

.order-ref {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #1e293b;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 6px;
}

.payment-method {
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
}

.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.secondary-btn {
  padding: 10px 16px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.primary-cta {
  padding: 10px 20px;
  border-radius: 10px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
`;

/**
 * Verified responsive CSS fix for automated test verification & fixture baseline checks.
 * Preserves all content, lets flex/grid children shrink (min-width: 0), wraps long tokens,
 * removes fixed height clipping on .plan-box, and wraps buttons cleanly on narrow viewports.
 */
export const CHECKOUT_CORRECTED_REFERENCE_CSS = `.checkout-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  padding: 20px;
  border-radius: 16px;
  background: #ffffff;
  border: 1px solid #dfe3ec;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
  color: #0f172a;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
}

.customer-block {
  flex: 1 1 180px;
  min-width: 0;
}

.eyebrow {
  display: block;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #64748b;
  margin-bottom: 4px;
  overflow-wrap: anywhere;
}

.customer-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  line-height: 1.3;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
  color: #0f172a;
}

.status-pill {
  flex: 0 1 auto;
  max-width: 100%;
  padding: 5px 10px;
  border-radius: 999px;
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #047857;
  font-size: 12px;
  font-weight: 600;
  white-space: normal;
  overflow-wrap: anywhere;
}

.plan-box {
  box-sizing: border-box;
  min-height: 76px;
  height: auto;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  margin-bottom: 16px;
}

.plan-row {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: baseline;
  gap: 6px 10px;
  margin-bottom: 6px;
}

.plan-title {
  flex: 1 1 150px;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  white-space: normal;
  overflow-wrap: anywhere;
}

.plan-price {
  flex: 0 0 auto;
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
}

.plan-note {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: #475569;
  overflow-wrap: anywhere;
}

.meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid #e2e8f0;
  border-bottom: 1px solid #e2e8f0;
  margin-bottom: 18px;
}

.meta-cell {
  min-width: 0;
}

.meta-label {
  display: block;
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  margin-bottom: 4px;
}

.order-ref {
  display: inline-block;
  max-width: 100%;
  box-sizing: border-box;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #1e293b;
  background: #f1f5f9;
  padding: 3px 6px;
  border-radius: 6px;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.payment-method {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #1e293b;
  overflow-wrap: anywhere;
}

.action-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: stretch;
  justify-content: space-between;
  gap: 10px;
}

.secondary-btn {
  flex: 1 1 110px;
  min-width: 0;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #ffffff;
  color: #334155;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  cursor: pointer;
}

.primary-cta {
  flex: 2 1 150px;
  min-width: 0;
  padding: 10px 16px;
  border-radius: 10px;
  border: none;
  background: #2563eb;
  color: #ffffff;
  font-size: 13.5px;
  font-weight: 600;
  line-height: 1.3;
  white-space: normal;
  overflow-wrap: anywhere;
  text-align: center;
  cursor: pointer;
}
`;

export const CHECKOUT_STARTER_SCENARIOS: StressScenario[] = [
  {
    id: 'baseline-ideal',
    name: 'Baseline — Short Sample Copy',
    category: 'baseline',
    viewport: { width: 460, height: 520, label: 'Desktop Card (460×520)' },
    mutations: [],
    rationale: 'Control render with original short design-mock content to confirm baseline appearance.',
    source: 'baseline',
  },
  {
    id: 'es-compound-customer-name',
    name: 'Spanish Compound Name Overflow',
    category: 'long_name',
    viewport: { width: 420, height: 520, label: 'Compact Tablet (420×520)' },
    mutations: [
      {
        slotId: 'slot-customer',
        value: 'María Fernanda Castellanos de Montes de Oca',
      },
      {
        slotId: 'slot-badge',
        value: 'Cuenta Empresarial',
      },
    ],
    rationale: 'Tests flex header shrinkage when a realistic full Latin American customer name meets a multi-word badge.',
    source: 'local_preset',
  },
  {
    id: 'unbroken-settlement-id',
    name: 'Unbroken Settlement Reference Token',
    category: 'unbroken_token',
    viewport: { width: 420, height: 520, label: 'Compact Tablet (420×520)' },
    mutations: [
      {
        slotId: 'slot-ref',
        value: 'SPEI_20261104_CDMX_99481726354829104756_AUTHOK',
      },
    ],
    rationale: 'Injects a continuous 46-character payment settlement identifier with no whitespace inside a 2-column CSS grid cell.',
    source: 'local_preset',
  },
  {
    id: 'bilingual-legal-renewal-note',
    name: 'Multi-line Bilingual Billing Disclosure',
    category: 'multilingual',
    viewport: { width: 420, height: 560, label: 'Compact Tablet (420×560)' },
    mutations: [
      {
        slotId: 'slot-plan',
        value: 'Plan Estudio Multisede + Respaldo Legal',
      },
      {
        slotId: 'slot-note',
        value:
          'Se cobrará automáticamente cada 12 meses en MXN al tipo de cambio vigente. Includes CFDI 4.0 tax invoice and 30-day cancellation notice.',
      },
    ],
    rationale: 'Expands plan title and billing disclosure note to test fixed-height container clipping.',
    source: 'local_preset',
  },
  {
    id: 'narrow-320-localized-cta',
    name: '320px Mobile + Localized Action Labels',
    category: 'narrow_viewport',
    viewport: { width: 320, height: 580, label: 'Small Mobile (320×580)' },
    mutations: [
      {
        slotId: 'slot-secondary-cta',
        value: 'Cambiar tarjeta',
      },
      {
        slotId: 'slot-primary-cta',
        value: 'Autorizar cargo anual',
      },
    ],
    rationale: 'Tests narrow 320px viewport with realistic Spanish button copy that exceeds a rigid nowrap flex footer.',
    source: 'local_preset',
  },
  {
    id: 'combined-worst-case-340',
    name: 'Combined Stress — 340px + Long Name + Hash + Disclosure',
    category: 'combined_stress',
    viewport: { width: 340, height: 640, label: 'Narrow Android (340×640)' },
    mutations: [
      {
        slotId: 'slot-customer',
        value: 'Alejandro Sebastián Villaseñor Echeverría',
      },
      {
        slotId: 'slot-note',
        value:
          'Cargo recurrente anual con emisión automática de comprobante CFDI y soporte prioritario 24/7 en español e inglés.',
      },
      {
        slotId: 'slot-ref',
        value: 'TXN_MX_00918273645546372819_LIVE',
      },
      {
        slotId: 'slot-primary-cta',
        value: 'Confirmar y pagar $49.00',
      },
    ],
    rationale: 'Combines narrow viewport, compound name, unbroken reference token, and multi-line legal note simultaneously.',
    source: 'local_preset',
  },
];

export const PAYOUT_FRAGILE_HTML = `<section class="payout-card" data-breakit-id="card-root">
  <div class="payout-top">
    <div class="recipient-meta">
      <span class="payout-tag" data-breakit-id="slot-tag">Liquidación inmediata</span>
      <h3 class="recipient-name" data-breakit-id="slot-recipient"> Diego Morales </h3>
    </div>
    <strong class="payout-amount" data-breakit-id="slot-amount">$1,280.00</strong>
  </div>

  <div class="account-strip">
    <span class="account-label">CLABE / Cuenta destino</span>
    <code class="account-code" data-breakit-id="slot-account">012180004829104421</code>
  </div>

  <p class="payout-memo" data-breakit-id="slot-memo">Pago de regalías correspondiente al corte semanal.</p>

  <div class="payout-actions">
    <button type="button" class="hold-btn" data-breakit-id="slot-hold-btn">Retener</button>
    <button type="button" class="approve-btn" data-breakit-id="slot-approve-btn">Enviar transferencia</button>
  </div>
</section>`;

export const PAYOUT_FRAGILE_CSS = `.payout-card {
  box-sizing: border-box;
  width: 100%;
  max-width: 410px;
  margin: 0 auto;
  padding: 20px;
  border-radius: 14px;
  background: #0f172a;
  border: 1px solid #1e293b;
  color: #f8fafc;
  font-family: 'Inter', -apple-system, sans-serif;
}

.payout-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.payout-tag {
  display: inline-block;
  font-size: 11px;
  font-weight: 600;
  color: #38bdf8;
  margin-bottom: 4px;
}

.recipient-name {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  white-space: nowrap;
}

.payout-amount {
  font-size: 18px;
  font-weight: 700;
  color: #34d399;
  white-space: nowrap;
}

.account-strip {
  padding: 10px 12px;
  border-radius: 10px;
  background: #1e293b;
  margin-bottom: 12px;
}

.account-label {
  display: block;
  font-size: 11px;
  color: #94a3b8;
  margin-bottom: 4px;
}

.account-code {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #e2e8f0;
  white-space: nowrap;
}

.payout-memo {
  margin: 0 0 16px 0;
  height: 36px;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.4;
  color: #cbd5e1;
}

.payout-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.hold-btn {
  padding: 9px 14px;
  border-radius: 8px;
  border: 1px solid #334155;
  background: transparent;
  color: #e2e8f0;
  font-weight: 600;
  white-space: nowrap;
}

.approve-btn {
  padding: 9px 18px;
  border-radius: 8px;
  border: none;
  background: #10b981;
  color: #022c22;
  font-weight: 700;
  white-space: nowrap;
}
`;

export const PAYOUT_STARTER_SCENARIOS: StressScenario[] = [
  {
    id: 'baseline-ideal',
    name: 'Baseline — Standard Payout',
    category: 'baseline',
    viewport: { width: 440, height: 480, label: 'Desktop Card (440×480)' },
    mutations: [],
    rationale: 'Baseline render with ideal short recipient and 18-digit CLABE.',
    source: 'baseline',
  },
  {
    id: 'long-beneficiary-entity',
    name: 'Long Beneficiary Legal Name',
    category: 'long_name',
    viewport: { width: 400, height: 480, label: 'Compact (400×480)' },
    mutations: [
      {
        slotId: 'slot-recipient',
        value: 'Productora Audiovisual Independiente del Valle de México S.A. de C.V.',
      },
    ],
    rationale: 'Legal corporate beneficiary name inside nowrap flex header next to currency amount.',
    source: 'local_preset',
  },
  {
    id: 'iban-swift-unbroken-routing',
    name: 'Unbroken International IBAN + SWIFT Descriptor',
    category: 'unbroken_token',
    viewport: { width: 390, height: 480, label: 'Mobile (390×480)' },
    mutations: [
      {
        slotId: 'slot-account',
        value: 'ES9121000418450200051332_SWIFT_CAIXESBBXXX_REF992817',
      },
    ],
    rationale: 'Continuous international routing descriptor inside nowrap code block.',
    source: 'local_preset',
  },
  {
    id: 'narrow-320-compliance-memo',
    name: '320px Mobile + Compliance Hold Memo',
    category: 'combined_stress',
    viewport: { width: 320, height: 540, label: 'Small Mobile (320×540)' },
    mutations: [
      {
        slotId: 'slot-memo',
        value:
          'Liquidación sujeta a retención definitiva de IVA/ISR conforme al comprobante fiscal digital adjunto al periodo.',
      },
      {
        slotId: 'slot-hold-btn',
        value: 'Poner en revisión',
      },
      {
        slotId: 'slot-approve-btn',
        value: 'Autorizar dispersión SPEI',
      },
    ],
    rationale: 'Tests fixed-height memo clipping and rigid action buttons at 320px viewport width.',
    source: 'local_preset',
  },
];

export const BUNDLED_FIXTURES: BundledFixture[] = [
  {
    id: 'checkout-summary-fragile',
    name: 'Checkout Order Summary Card',
    tagline: 'Looks clean with sample copy; breaks on compound Spanish names, long settlement IDs & 320px screens.',
    description:
      'E-commerce subscription checkout card with flex header, fixed-height plan disclosure box, 2-column metadata grid, and dual CTA footer.',
    html: CHECKOUT_FRAGILE_HTML,
    css: CHECKOUT_FRAGILE_CSS,
    referenceCorrectedCss: CHECKOUT_CORRECTED_REFERENCE_CSS,
    starterScenarios: CHECKOUT_STARTER_SCENARIOS,
  },
  {
    id: 'payout-card-fragile',
    name: 'Creator Payout Approval Card',
    tagline: 'Dark-theme treasury payout card vulnerable to corporate beneficiary names, IBAN routing tokens & narrow mobile.',
    description:
      'Treasury disbursement card with nowrap recipient header, monospace routing strip, fixed-height memo, and right-aligned action buttons.',
    html: PAYOUT_FRAGILE_HTML,
    css: PAYOUT_FRAGILE_CSS,
    starterScenarios: PAYOUT_STARTER_SCENARIOS,
  },
];

