# BREAK IT — demo narration

Duration: 2:42. Edited actual UI and Chromium captures, with macOS Samantha synthetic narration. Not an uncut screen recording.

## 01. A CSS patch is a hypothesis.

A CSS fix from an AI is still a guess until a browser tests it. BREAK IT turns that guess into a reproducible experiment.

## 02. Start with your component.

Start with a static component you own. This checkout looks correct with its short sample copy. BREAK IT finds text and control slots. You review the required content and layout rules before running anything: no overflow, no clipping, and visible, separated buttons.

## 03. Muse Spark writes the adversarial cases.

Muse Spark one point three creates adversarial content and viewport combinations, including compound Spanish names, long payment identifiers, expanded disclosures, and narrow phones. This recording used a fresh Meta Model API request. The eight generated cases join one unchanged baseline. Here are the real response receipts.

## 04. Chromium measures what actually breaks.

Playwright Chromium now renders all nine cases. The model does not assign the grades. The browser measures element bounds, text clipping, control overlap, and button visibility. Seven scenarios fail. In this example a customer name pushes content outside a three hundred sixty pixel viewport. Every failure has measurements and a real capture.

## 05. The model sees the failure evidence.

We send Muse Spark the component, the failing measurements, and three actual screenshots. It proposes CSS and explains the suspected causes. You can inspect the complete diff. The HTML and test pack remain locked. If you edit the proposed CSS, the app changes its attribution so your edits cannot masquerade as untouched model output.

## 06. Same inputs. Verified improvement.

Now replay the candidate against exactly the same inputs and assertions. This run improves from two of nine scenarios passing to nine of nine. Twenty five assertion failures are fixed, with no measured regression. The matching pack hash makes the comparison auditable. Passing means these declared layout checks passed on these cases, not that the application is universally correct.

## 07. Take the proof with you.

Export the patch with its original component, locked scenarios, assertion logs, before and after screenshots, and model receipts. The ZIP includes a standalone Chromium runner compiled from the same evaluator as the app. Another developer can reproduce the failures and the candidate result without making another model call.

## 08. Find the break. Propose the patch. Prove it.

We also checked a separate boarding pass example: zero of nine to nine of nine. These are intentionally fragile examples, not a broad benchmark. BREAK IT is a hackathon MVP for static HTML and CSS. The public repository includes the code and replayable evidence.
