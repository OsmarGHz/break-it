# BREAK IT — bounded MVP specification

## Why this exists

The previous PATCH IRL build offered advice and image editing for a desk. The participant correctly observed that this is easy to reproduce by asking a general model. BREAK IT shifts the product's work to actual execution: the browser renders adversarial scenarios, the engine evaluates declared assertions, and the same scenarios are replayed after a model-proposed change.

This is a new project. Do not modify, rename or overwrite PATCH IRL. Reuse lessons about Meta authentication and structured output, not its product claims or participant photos.

## One complete flow

1. Load a bundled, intentionally fragile static HTML/CSS card, or paste a small owned component.
2. Identify text slots and the layout assertions to enforce. Give relevant elements stable internal IDs and let the user review the selections.
3. Call Muse Spark 1.3 for 6–12 adversarial scenarios using a bounded schema: named text-slot replacements and a small set of viewport sizes. Include realistic Spanish/English text, a long name, unbroken text and narrow screens. Validate every target and cap content lengths.
4. Render the real component in isolated Chromium contexts. Apply only the validated mutations. Capture actual screenshots and measured element/viewport dimensions.
5. Show a matrix of results with the exact assertion and measured evidence for each failure. Clicking a failure opens its real rendered case and highlights the relevant bounds.
6. Send the original HTML/CSS, failing measurements and, if available, actual failure captures to Spark. Request a scoped CSS-only patch plus rationale. Use the documented Meta request format; do not invent an image input or response field.
7. Apply the proposed CSS in a separate candidate. Run precisely the same scenario/assertion pack again.
8. Compare measured results and original/candidate screenshots. Keep remaining failures visible. Export an evidence bundle and the actual CSS diff.

## Computed assertions, not AI verdicts

Prefer a few declared invariants over generic scores:

- No horizontal overflow beyond the viewport, with a documented small rounding tolerance.
- A declared CTA remains visible, has nonzero bounds and remains within the chosen card and viewport.
- A declared text slot is not clipped; inspect both its own overflow and ancestor clipping.
- Optional separation between explicitly selected interactive controls; overlapping rectangles are not universally bugs.

A valid fix cannot simply hide/remove the title, CTA or replaced text, make them transparent, or suppress a failing assertion. Preserve relevant content and required elements and explicitly test their visibility. Tests should catch such evasions. Intentional ellipsis, overlap and hidden content need user-reviewed exceptions; do not silently call every such design a bug.

Use pass/fail/inconclusive/error states where appropriate. A renderer or assertion error must not become a pass. Counts reflect executed tests only. Do not call the component accessible, secure, correct or production-ready based on these layout checks.

## Scope

IN: one static HTML/CSS component, local assets, user-reviewed slots/assertions, bounded content/viewport mutations, actual rendering, CSS correction, identical retest and export.

OUT: arbitrary authenticated websites, crawling, application JavaScript, React project import, checkout transactions, arbitrary generated test code, arbitrary Node/Python execution, general security auditing, complete accessibility certification, multi-browser/cloud grids and automatic deployment of user code.

No arbitrary URL field is needed for the first MVP.

## Proposed architecture

- Frontend: React, Vite, TypeScript. A coherent professional workbench, with readable previews, a failure matrix, a clear current run and evidence details.
- API: local Node server. Validate all inputs and keep Meta credentials server-side.
- Renderer: Playwright Chromium in fresh contexts with fixed browser settings. Record the browser version. Use bundled fonts, deterministic local assets, fixed locale/time where relevant, reduced motion and stable capture conditions.
- Input isolation: user components are untrusted. Strip scripts, event handlers, embedded frames/objects, navigation triggers and active content. Isolate the render document; do not borrow a personal browser profile. Block external network requests, downloads, popups and navigation. Test that remote CSS/image URLs and redirects cannot contact external hosts. Do not expose local files or server credentials to the render document.
- Queue: bounded concurrency, timeouts, input-size limits and cleanup of browser contexts. A stalled render should produce an explicit run error.
- AI: raw Meta Model API calls or an appropriately configured SDK; Muse Spark 1.3 for scenario generation and patch reasoning. Structured Chat Completions JSON schema has been verified in the preceding project. Recheck docs for exact fields. Muse Image is optional only if a meaningful tested use exists; do not add it as decoration.
- Data: local run artifacts with clear input/scenario identifiers. Do not send secrets or unnecessary local files to Meta. Document that the selected component and evidence are sent when the user invokes model operations.

A static hosting deployment cannot be treated as a browser-rendering backend. Make local execution work first; document a supported server-hosting path separately if there is time.

## Suggested data contracts

The exact shape can be refined, but keep these concepts explicit:

- Component: original HTML, original CSS, reviewed text slots and stable target IDs.
- Assertion: ID, type, target IDs, bounds/tolerance, enabled state and any reviewed exception.
- Scenario: stable ID, viewport, slot replacements and rationale; no arbitrary executable code.
- Run: component hash, scenario/assertion pack hash, browser version, timestamps, actual measurements, outcomes, errors and screenshot artifact paths.
- Candidate: CSS patch, actual diff, model receipt and candidate hash.
- Comparison: identical scenario/assertion pack IDs on both sides; changes in results and any remaining failures.

The model may propose cases and a candidate; it cannot edit executed results or remove cases to improve the count.

## Meaningful verification

- A known fragile fixture fails for its intended geometric reason in real Chromium.
- A known corrected fixture passes the same assertions and scenarios.
- Hiding a required element is a failure, not a successful patch.
- A long unbroken text case and a narrow-viewport case are executed.
- Retest preserves the original scenario and assertion pack.
- Malformed or invalid model output fails clearly without canned success.
- External network attempts and active content in imported components are blocked.
- A renderer failure is recorded as an error/inconclusive result.
- The exported bundle can reproduce the checked cases through a documented command or runnable test file.

Use focused tests for these failure modes. Do not spend the time budget on tests that merely copy implementation details.

## Product and demo

Keep the visual treatment polished but evidence-led. Actual rendered previews, geometric failure overlays and a before/after run matrix provide the visual story. Do not invent a score, benchmark, number of tests, number of bugs, timing or repaired state.

A suggested short-video sequence:

1. A card looks fine with ideal sample content.
2. Run the generated stress pack; actual failing cases appear.
3. Open one failure and show the measured cause.
4. Ask Spark for a CSS candidate.
5. Replay exactly the same pack; inspect the actual differences.
6. Download the patch and reproducible tests.

There are existing visual-testing and AI-testing products. Do not claim this is the first such tool or impossible to replicate. The proposed focus is fast adversarial content testing with explicit browser evidence and a bounded patch–retest loop for small components.

## Handoff back to Codex

Before stopping, leave:

- Exact install/run/test commands and required local environment names.
- Working port(s), active processes and current blockers.
- What really works, what is partial and what is still a proposal.
- Model receipts for successful calls, excluding keys and raw sensitive inputs.
- At least one actual fragile/corrected fixture pair and its run results.
- Remaining failures and the next highest-priority changes.

Do not claim a completed feature unless it was exercised. Keep this handoff easy for the next coding agent to continue.
