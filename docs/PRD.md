# Supplier Delivery Tracking — Prototype PRD
Date: October 26, 2026
Status: Implementation draft for Claude Code

## 1. Instructions and authority
Build a focused working prototype for a fictional Anduril interview case. This document replaces the broader Material Planning and Readiness PRD for this new repo. Do not import requirements or code from that application by default. Read ARCHITECTURE.md alongside this file. Kyle owns product choices and the interview narrative; do not invent research, user validation, or business results.

Railway hosting is the user's architectural requirement. Other implementation choices and detailed rules below are proposed defaults chosen to make the narrowed scope concrete. Implement these defaults unless Kyle changes them. Flag material contradictions; do not expand scope to solve them.

## 2. Problem and outcome
Help a purchaser identify incoming direct materials that may delay production, maintain supplier delivery commitments, and record agreed date/quantity changes.

Core question: Which incoming items need attention, which work orders are affected, and what should I follow up on?

Primary user: purchaser managing existing supplier orders. Work orders, requirements, and PO allocations are upstream context, not editable planning workflows.

The assignment includes supplier tracking, capacity, arrival coordination, logistics cost, and inventory visibility. This prototype selects supplier delivery tracking and production-impact visibility. It does not claim to solve all of those problems.

## 3. Assumptions and limits
- Small/custom-part suppliers often communicate updates outside integrated systems. This is an experience-informed hypothesis, not verified Anduril practice.
- Manual recording is sufficient to demonstrate the decision workflow. Its real operating burden remains untested.
- Existing systems supply accurate work-order requirements and PO-to-work-order links.
- For this demo, all linked material is needed at production start. No routing or operation-level schedule.
- Comparing arrival with start flags a date conflict, not a guarantee of readiness. Receiving/inspection time is not modeled.
- Supplier negotiation happens outside the application. Saving an update records an agreement; it does not send a PO amendment or secure supplier consent.
- Use synthetic data only. No live AI, supplier, email, ERP, or carrier connection.

## 4. Scope
### Include
1. Incoming items view across existing POs.
2. Purchase-order detail with delivery schedule, production impact, and supplier follow-ups.
3. Manual expected-arrival updates with source, timestamp, and note.
4. Split an unshipped delivery commitment into quantities with separate expected arrivals.
5. Record and complete supplier follow-up tasks.
6. Persist edits, preserve a simple change history, and reset synthetic demo data.

### Exclude
PO creation/approval/transmission; procurement sourcing; replenishment; purchasing consolidation; supplier capacity modeling; inventory management; automatic reservation; allocation reprioritization; transfers; receiving/QA/staging execution; fixtures; cancellation workflows; freight pricing/optimization; production scheduling; automated messages; AI email extraction; live integrations; accounts/roles; dashboards and KPI charts.

Do not build a separate work-order, supplier, task-management, or inventory module. Show relevant context within the two primary views.

## 5. Vocabulary
| Label | Meaning |
|---|---|
| Expected arrival | Current expected arrival at the destination warehouse, not ship date |
| Delivery schedule | Quantity/date commitments, including those not yet shipped |
| Planned delivery | Unshipped quantity with a known or unknown expected arrival |
| In transit | Shipment reported as dispatched; not proof of receipt |
| Received | Read-only upstream fact in seeded data |
| Production start | Read-only start date of an affected work order |
| Late | Expected arrival later than the linked production start |
| Date unknown | Outstanding quantity has no expected arrival |
| Arrival overdue | Expected arrival has passed and receipt is not recorded |
| Follow-up due | Open follow-up dated on or before the demo's current date |

Use these labels consistently. Do not call planned deliveries actual shipments. Avoid “ready,” “covered,” or “resolved” when only an arrival estimate has changed.

## 6. Screens and behavior
### A. Incoming items — default landing screen
One row per delivery-schedule line. A PO item split into two deliveries produces two rows. Do not duplicate rows for every affected work order.

Columns: PO, supplier, part number/description, destination, delivery quantity, delivery state, expected arrival, earliest linked production start, affected work orders, attention reason, next follow-up. Show aggregate affected counts with details available on expansion; do not imply the earliest start applies to every unit.

Default to outstanding deliveries needing attention. Provide All outstanding and Received filters. Search PO/part/supplier; filter supplier and attention reason. Ordinary sortable tables are sufficient.

Primary actions:
- Update arrival: compact form available from the row.
- Open PO: navigate to the same underlying record in detail.
- Add follow-up: open a small form prelinked to the PO and optionally delivery.

Show the strongest attention reason, with other reasons in expandable details:
1. Date conflict with production start.
2. Arrival overdue.
3. Date unknown.
4. Follow-up due.
5. No identified date issue.

Sort within attention groups by earliest affected production start, unknown starts last. Document this as a simple demo ordering rule, not optimized priority. Supplier criticality and program priorities are not modeled.

### B. Purchase-order detail
Header: PO number, supplier, buyer, destination, order status. Two tabs: Deliveries and Follow-ups.

Deliveries:
- Group schedule lines under their PO item.
- Show ordered quantity and the planned/in-transit/received breakdown without double counting.
- Expand a delivery to see work-order number, program, linked quantity, production start, and date impact.
- Actions: update arrival; split planned delivery.
- Show a compact chronological change history with old/new values, source, timestamp, and note.

Follow-ups:
- PO-level tasks with optional delivery reference, due date, note, open/completed state, and completion note.
- Add, edit, or complete a task. Do not send notifications.
- Completing a task never changes arrival information or clears a delivery risk.
- Show follow-up count/due indicator on Deliveries; no separate task application.

### UI principles
Use compact, readable tables and labeled forms. Keep supplier, part, quantities, and dates visible where decisions happen. No decorative charts, prose-heavy summary cards, coverage bars, or duplicate status columns.
Show explicit save success/error, loading and empty states. Disable repeated submits while saving. Forms retain input on validation failure.
Support desktop/laptop widths and scrolling for tables; no separate mobile design project.

## 7. Updates and splits
### Update arrival
Accept a date or explicit unknown, source (Supplier email, Supplier call, Carrier update, Other), and a short note. Retain old/new arrival values and update timestamp. Apply only to the selected delivery quantity. Update all derived views after save; keep production start unchanged.

The source labels record manual information provenance. They do not imply integrations or independently verified dates.

### Split planned delivery
Only planned/unshipped schedule lines can be split. Enter two or more positive integer quantities whose sum equals the original quantity. Each gets an expected arrival or unknown.

Preserve the original PO item and upstream work-order allocations. For a delivery linked to multiple work orders, include a small quantity grid assigning each existing work-order link across the new delivery rows:
- Each work order retains its original total assigned quantity.
- Each delivery's assigned quantities cannot exceed its quantity.
- Unassigned remainder is displayed explicitly.
- Do not automatically choose which work order gets the earlier delivery.
- This only associates already-committed demand with delivery dates; it cannot move demand between POs or change work-order totals.

Preview resulting date conflicts, then save all changes together. Cancel leaves data unchanged. Preserve history for the replaced delivery. Block splits of in-transit or received records; physical shipment correction is out of scope.

## 8. Calculation and integrity rules
- Use date-only YYYY-MM-DD values for business dates; UTC timestamps for history.
- Arrival later than production start = late. Equal date = no calculated date conflict, with the global processing-time limitation visible.
- Null date = unknown, never on time.
- Received deliveries have no active inbound date alerts. They do not establish whole-work-order readiness.
- Evaluate each work-order/delivery link separately. A delivery can affect multiple work orders differently.
- For a work order linked to multiple deliveries, show late quantity and unknown-date quantity separately. Do not label its full quantity late because one portion is late.
- PO ordered quantity equals active planned + in-transit + received quantities. Superseded split parents are excluded.
- Quantities are positive integers in one unit per part; unit conversions and partial receipts are out of scope.
- Edits and split/history writes are transactional. Reject stale updates rather than overwrite another saved change.
- No historical event, follow-up completion, or duplicate submit creates additional supply.

## 9. Seed data and demonstration
Create the following synthetic dataset:
- 20 suppliers, all represented by at least one PO. Five suppliers have two POs each; the remaining 15 have one each.
- 2 destination warehouses.
- 25 POs: 5 with 10 item lines each (20%); 10 with 1 item line each; and 10 with 2 item lines each (the latter two groups together are 80%). This produces 80 PO item lines in total.
- 40 work orders distributed across the two warehouses. Every work order has at least one linked PO item. Most work orders depend on several PO items; some PO items support multiple work orders. Allow repeat part numbers across different POs so the data does not look artificially unique.
- Delivery-schedule rows may exceed 80 because some PO items have split deliveries. Splitting never increases ordered quantity or PO item count.

Distribute healthy records and exceptions across suppliers, POs, and work orders; do not make every record require action. Ensure every PO-to-work-order link has a matching destination warehouse and consistent quantities. Preserve the primary demo below as a clearly identifiable subset of the larger dataset, with the remaining records providing realistic context. Use fictional industrial parts and programs; no real Anduril data.

Persist a demo reference date at initial seed/reset. Generate business dates relative to it and display “Demo date” in a small banner so a later interview doesn't invalidate the scenarios. Normal restarts must not reseed or shift dates.

Required examples:
- Arrival before production start.
- Known late arrival.
- Missing expected arrival.
- Arrival overdue with no receipt.
- Follow-up due with otherwise timely arrival.
- A planned delivery shared by two work orders.
- In-transit delivery with carrier-sourced manual update.
- Received line shown read-only.

Primary demo:
1. PO line has 100 units: 40 linked to WO-A starting D+7, 60 to WO-B starting D+14. Initial arrival D+5.
2. Record supplier delay to D+16. Show A late 40 and B late 60.
3. Record agreed split: 40 arrive D+6 for A, 60 arrive D+16 for B.
4. A has no calculated date conflict; B remains late 60. Original order total stays 100.
5. Add and complete a follow-up without improving B's date. B remains late.
6. Refresh; changes persist. Reset with confirmation restores the baseline.

Reset is a demo utility, not a workflow. Clearly state that all visitors share the same synthetic dataset.

## 10. Acceptance and testing
Verify the primary demo end to end. Also test:
- Unknown arrival is never treated as timely.
- A split totaling 99 or 101 is rejected; invalid work-order distribution is rejected.
- A failed split leaves the original delivery and history unchanged.
- A second submit/stale version cannot create extra deliveries or overwrite updates silently.
- In-transit/received splits are blocked.
- Refresh and server restart preserve updates.
- Date-only comparisons are stable across browser timezones.
- Closing a follow-up does not clear date risk.
- Deep-link navigation to a PO works after refresh.

Automated tests demonstrate software behavior, not validation of buyer needs. Keep a short factual test log; do not invent interviews or measured production benefits.

## 11. Implementation order
1. Scaffold repo and persistence per ARCHITECTURE.md; seed data.
2. Build Incoming items and PO detail from the same data.
3. Implement arrival updates and derived impact.
4. Implement planned-delivery splitting and quantity checks.
5. Add follow-ups, history, and confirmed reset.
6. Run targeted tests, production build, and Railway deployment checks.

Finish each slice before adding polish. If a requirement threatens the narrow scope, explain the issue and propose the smallest adjustment; do not revive the broader ERP-like app.

## 12. Definition of done
Two connected views; all specified actions actually persist; a reproducible demo; passing critical tests; a working production build; Railway-ready configuration and deployment instructions. Claim a live Railway deployment only after actually verifying it. Deliver a short README with startup, reset, demo steps, limits, and checks performed.

