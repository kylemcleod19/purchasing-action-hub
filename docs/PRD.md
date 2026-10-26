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
- Each PO belongs to exactly one work order. All its items and deliveries inherit that work order and production start date. A work order may have multiple POs. This is a prototype simplification; shared-demand POs are out of scope. Existing systems supply these read-only relationships.
- For this demo, all linked material is needed at production start. No routing or operation-level schedule.
- Comparing arrival with start flags a date conflict, not a guarantee of readiness. Receiving/inspection time is not modeled.
- Supplier negotiation happens outside the application. Saving an update records an agreement; it does not send a PO amendment or secure supplier consent.
- Use synthetic data only. No live AI, supplier, email, ERP, or carrier connection.

## 4. Scope
### Include
1. Incoming items view across existing POs.
2. Purchase-order detail with delivery schedule, production impact, and supplier follow-ups.
3. Manual expected-arrival updates with source, timestamp, and an optional note.
4. Split an unshipped delivery commitment into quantities with separate expected arrivals.
5. Resolve delivery issues inline, independently of physical delivery risk; retain optional follow-up reminders.
6. Persist edits, preserve a simple change history, and reset synthetic demo data.

### Exclude
PO creation/approval/transmission; procurement sourcing; replenishment; purchasing consolidation; supplier capacity modeling; inventory management; automatic reservation; allocation reprioritization; transfers; receiving/QA/staging execution; fixtures; cancellation workflows; freight pricing/optimization; production scheduling; automated messages; AI email extraction; live integrations; accounts/roles; dashboards and KPI charts.

Do not build a separate work-order, supplier, task-management, or inventory module. Show relevant context within the two primary views.

## 5. Vocabulary and date rules
| Label | Meaning |
|---|---|
| Required dock date | Read-only date the PO item is required at its destination; independent of the latest estimate |
| Expected arrival | Latest estimated arrival at the destination, never ship date |
| Not shipped | Delivery commitment that has not been dispatched; not an actual shipment |
| In transit | Dispatched quantity not yet received |
| Received | Read-only upstream fact; display actual received date |
| Production start | Read-only start of the PO's single work order |
| Late | Outstanding expected arrival is after required dock date |
| Production conflict | Outstanding expected arrival is after production start |
| Overdue | Expected arrival is before demo date, with no recorded receipt |
| Date unknown | Outstanding delivery has no expected arrival |
| Needs action | Delivery has an open issue requiring buyer disposition |
| Resolved | Buyer disposed of the issue; does not mean the material is on time |

Required dock date is an explicit prototype default added to distinguish supplier lateness from production impact. Seed it on each PO item, on or before production start. Never replace it when updating an expected arrival. These business dates are not PO creation dates. No dock-date or production-schedule editing workflow is included.

## 6. Screens and behavior
### A. Incoming items
One row per active delivery commitment, including separate rows for splits. Inherit work order and production start from the PO.

Use compact columns: PO, supplier, part, quantity, state, Required dock, Expected arrival, Production start, Last update, issue indicator, actions. Destination and descriptive context can appear in expansion. Dates must be visible, not buried in tooltips. Use numeric quantities, short state labels, and icons; never compose sentences explaining quantities or lateness in cells.

Default filter: Needs action (open delivery issues). Also provide All outstanding, Late, Date unknown, and Received. Late includes accepted/resolved delays. Search PO/part/supplier and filter supplier and delivery state. Sort open issues by production conflict first, then production start, required dock, and stable ID. This is a demo ordering rule, not optimized priority.

Actions open the same update/split/resolution forms used in PO detail. Opening the PO expands the relevant item. No trip to Follow-ups is required to resolve an issue.

### B. Purchase-order detail
Header: PO number, supplier, buyer, destination, order status, work order, and prominent Production start. Keep Deliveries and Follow-ups tabs; follow-ups are optional reminders, not the issue-resolution workflow.

One semantic item table, with columns:
**Expand | Line | Part number | Description | Unit | Ordered | Shipped | Received | Required dock | Arrivals | Action**.

- Ordered is the full item quantity. Shipped is cumulative dispatched quantity, including received units. Received is cumulative received quantity. Thus `Received <= Shipped <= Ordered`; never sum these three columns. In transit is Shipped minus Received. Not shipped is Ordered minus Shipped. Define this in header tooltips; do not add repeated explanations per row.
- Remove Planned, Late quantity, Date unknown quantity, and the six-column item-total grouping from the collapsed table.
- Arrivals contains vertically stacked dates. With one active delivery, show only its date and icon, without quantity. With multiple active deliveries, show date plus quantity in parentheses for each. Use actual received date and a check icon for received deliveries; expected arrival otherwise. Unknown is an em dash with question icon and accessible label.
- Show at most two arrivals initially, prioritizing open issues, then outstanding late/unknown/overdue deliveries, then other outstanding, then received. Sort within groups by date and ID. A compact `+N` control expands the full delivery table. Never merge different deliveries merely because their dates match. Quantity suppression depends on the full active delivery count, not the selected filter.
- Warning icons/color beside dates show delivery risk; a separate Action cell shows an open-issue icon and count. Resolving removes the action badge, not the date warning. Use subtle row emphasis for open issues; avoid full-row red on every delayed-but-accepted item. Tooltips explain exact date comparisons and days late; keep prose out of table cells.
- Default item ordering: open issues first, then unresolved physical date risk, then other items, with line number as tiebreaker. Preserve row focus/expansion during saves; communicate if the current filter removes a resolved item.
- Accordion expansions contain a semantic delivery table: Delivery | Quantity | State | Required dock | Expected/received arrival | Production start | Last update | Issue | Actions. No repeated card/div sections or prose quantity breakdowns. Use compact labels Open/Resolved/em dash in Issue and accessible risk icons next to dates.
- Row actions: Update arrival; Split delivery (not shipped only); Resolve issue (open issue only). A single-delivery item may expose Update arrival directly on its collapsed row. Multiple deliveries use expansion to select the target.
- Filters: All, Not shipped, In transit, Received; additionally All issues / Needs action / Resolved issues. Filters combine. An item is visible if any delivery matches. Expanded deliveries and arrival stacks show matching deliveries; Ordered/Shipped/Received remain full item totals, labeled once above the table as “Quantities: all deliveries.” Preserve filters after saves and show explicit empty states.
- Allow multiple expanded items. Use keyboard-accessible buttons, aria-expanded, and valid nested tables inside spanning detail cells.

### Follow-ups and history
Keep existing PO-level reminders with optional delivery reference, due date, note, and completion. Due reminders are visible on the Follow-ups tab and through a compact due count/link; they do not create or reopen delivery issues. Completing a reminder does not resolve an issue; resolving an issue does not complete a reminder. Keep these actions clearly labeled and independent.

Render change history as a compact table with timestamp, event, delivery, old/new values, actor, source, and optional note. Notes may be prose in forms/history detail; the ban on prose applies to operational quantity/status summaries.

### Last update, dates, and accessibility
Last update is the latest arrival-information update date plus source icon: envelope (Supplier email), phone (Supplier call), package (Carrier update), document (Other/Initial schedule). Include accessible labels/tooltips and full timestamp in detail. Resolution, follow-up completion, and notes alone must not refresh arrival-information timestamps. Resolution actor/time are separate history fields.

Use business dates formatted `Oct 26, 2026`, non-wrapping. Date icons distinguish received, late/overdue, and unknown; production conflict is also identified accessibly. Do not rely solely on color. An icon is not a receipt checkbox or receipt-entry action. No receiving workflow is introduced.

Use labeled forms, explicit loading/empty/error/save states, and retain input on failure. Disable duplicate submits. No decorative charts, summary cards, prose-heavy table cells, or separate mobile-design project.

## 7. Updates, splits, and issue resolution
### Update arrival
Accept date or explicit unknown, source, and Note (optional). Blank notes must pass client/server validation. Update only the selected delivery, preserve prior values in history, and never modify required dock date or production start. Received records are read-only.

When an issue is open, the same form offers **Save changes** and **Save and resolve issue**. The latter includes a compact outcome selector and optional resolution note. Without an open issue, use Save changes; if the change introduces an exception, show the new issue inline immediately.

### Split delivery
Only active not-shipped commitments may split. Enter two or more positive integer quantities summing to the original quantity, each with an expected date or unknown. Children inherit PO item, required dock date, work order, and production start. No allocation grid or work-order reassignment. Preview dates/risks in table columns.

Use the same Save changes / Save and resolve issue choices when the source has an open issue. The resolution applies only to the selected source commitment and resulting children, never unrelated deliveries. In-transit and received splits are blocked. Preserve the superseded parent and history; cancel/failure leaves everything unchanged.

### Separate buyer action from physical delivery risk
Maintain at most one open issue per active delivery. Multiple reasons can belong to that issue. Open an issue for an outstanding delivery when it first has a late arrival, production conflict, overdue arrival, unknown date, or a later expected arrival than its prior known estimate. A moved-later estimate can require review even while still before required dock date.

Resolution outcomes:
- **Accepted delay**: buyer accepts the current commitment; no date edit required. Offer “Accept delay and resolve” inline.
- **Date restored**: updated arrival meets required dock date and is not overdue; validate this outcome.
- **Split delivery agreed**: the split form saved a negotiated schedule; some children may remain late.
- **Reviewed / no further action**: explicit disposition for other reviewed cases, including unresolved uncertainty. Do not imply the uncertainty disappeared.

Record actor, timestamp, outcome, optional note, and the exact delivery facts reviewed. Use the PO buyer as a clearly labeled demo actor; no login or identity verification. All notes remain optional.

Save changes alone keeps an existing issue open, even if the new date is on time. Save and resolve applies the edit and disposition atomically. Merely opening a row or editing a note does not resolve an issue. Resolving may leave late/unknown quantities and production conflicts visible. Do not claim whole-work-order readiness.

### Reopening and splits
A resolved issue must not reopen on refresh, repeated calculations, an identical date update, or a source/note-only change. Open a new issue linked to prior history if the expected arrival moves later again, becomes unknown, or a newly active risk reason appears (for example it becomes overdue). Improving a date while the same already-accepted risk persists does not reopen it. Keep prior resolutions intact.

On a split with Save changes, transfer the open issue context to each outstanding child (even an on-time child) so the buyer can explicitly dispose of the negotiated schedule; supersede the parent's open issue. Without an existing open issue, evaluate children normally. With Save and resolve, record the split outcome on the parent and resolved child dispositions against their saved facts, preventing immediate re-alerting for accepted late children. Subsequent adverse changes can open new child issues. This is issue lineage, not material allocation.

Carrier updates can create issues too; in-transit does not automatically mean no action is possible. Permit arrival updates and acceptance/review, but not splitting dispatched quantities. No carrier integration is required.

## 8. Calculation and integrity rules
- Date-only YYYY-MM-DD business dates; UTC history timestamps. Use the persisted demo date for overdue checks.
- Expected arrival > required dock date = late. Expected arrival > production start = production conflict. Equality is not flagged; disclose that receiving/inspection time is not modeled.
- Null arrival is unknown, never on time. Overdue is expected arrival < demo date and not received.
- Received deliveries have no active inbound alerts; show actual received date. Preserve historical issues for audit, not in Needs action. Receipt execution remains excluded.
- Active not-shipped + in-transit + received quantities = ordered quantity. Cumulative shipped = in-transit + received. Exclude superseded parents throughout.
- A remaining production-conflicting quantity still poses production risk under the all-materials-needed-at-start assumption, even after buyer acceptance or an early partial delivery.
- Never sum units of different parts into a work-order readiness quantity.
- Updates, splits, issue dispositions, and history are transactional. Version-check both delivery and issue state; stale/duplicate submissions must not overwrite edits or duplicate supply/issues.

## 9. Seed data and demonstration
Create the following synthetic dataset:
- 20 suppliers, all represented by at least one PO. Five suppliers have two POs each; the remaining 15 have one each.
- 2 destination warehouses.
- 25 POs: 5 with 10 item lines each (20%); 10 with 1 item line each; and 10 with 2 item lines each (the latter two groups together are 80%). This produces 80 PO item lines in total.
- 20 work orders across the two warehouses: five have two POs each and fifteen have one each, totaling 25 POs. Every PO has exactly one work order and every work order is represented. All PO items inherit that relationship. Allow repeat part numbers across different POs. This replaces the earlier 40-work-order seed requirement, which cannot give every work order a PO under the new relationship.
- Delivery-schedule rows may exceed 80 because some PO items have split deliveries. Splitting never increases ordered quantity or PO item count.

Give each supplier a coherent specialty/catalog: a plastics supplier sells molded/machined plastic parts, a bearing supplier sells bearings, and so on. The five large POs contain ten plausible parts from that supplier’s specialty; use a clearly named broad distributor only deliberately. Do not randomly assign valves, circuit boards, harnesses, and plastics to one specialist. Seed required dock dates and received dates explicitly.

Distribute healthy records and exceptions across suppliers, POs, and work orders; do not make every record require action. Ensure every PO-to-work-order link has a matching destination warehouse and consistent quantities. Preserve the primary demo below as a clearly identifiable subset of the larger dataset, with the remaining records providing realistic context. Use fictional industrial parts and programs; no real Anduril data.

Persist a demo reference date at initial seed/reset. Generate business dates relative to it and display “Demo date” in a small banner so a later interview doesn't invalidate the scenarios. Normal restarts must not reseed or shift dates.

Required examples:
- Arrival before production start.
- Known late arrival.
- Missing expected arrival.
- Arrival overdue with no receipt.
- Follow-up due with otherwise timely arrival.
- A work order with two POs, and a PO item split into deliveries with different dates for the same work order.
- In-transit delivery with carrier-sourced manual update.
- Received line shown read-only.

Also seed open issues, accepted late issues, a date-restored resolution, split deliveries, and a later adverse update suitable for reopening. Make Last update sources and timestamps plausible. Keep 20 suppliers, 25 POs, 80 item lines, and 20 work orders as specified above.

Primary demo:
1. 100 units for WO-A: required dock D+5, production start D+7, initial arrival D+5.
2. Record delay to D+16. One open issue appears; late and production-conflict dates are visible.
3. Split into 40 at D+5 and 60 at D+16. Choose Save and resolve issue with Split delivery agreed in that same form.
4. Ordered remains 100; Shipped/Received remain zero. The two arrivals show quantities in parentheses. The 60-unit arrival keeps its warning; no open action remains for this handled split. Work-order production risk persists.
5. Move the 60-unit estimate to D+18. A new issue opens. Accept delay and resolve inline without changing the date.
6. Complete a reminder; arrival dates, Last update, and resolution remain unchanged. Refresh/restart preserves state; confirmed reset restores baseline.

## 10. Acceptance and testing
- Verify dataset counts, supplier/catalog coherence, one work order per PO, and matching warehouse links.
- Ten-item PO is one semantic table. Collapsed quantities are Ordered/Shipped/Received, with no prose status or quantity breakdown.
- Single delivery arrival omits quantity; multiple arrivals show quantities, warning/check/unknown icons, at most two dates, and +N expansion. Hidden open issues are still represented by Action count.
- For 100 ordered, 30 in transit, 20 received, 50 not shipped: Shipped=50, Received=20. Full totals survive filters.
- Required dock, expected arrival, and production start remain distinct. Updating estimates never resets baseline dates.
- An arrival after required dock but before production start is late without production conflict.
- Unknown is never timely; received rows show actual receipt date and have no active actions.
- Blank arrival and resolution notes save successfully.
- Save changes retains open issue; Save and resolve closes it in one atomic mutation without navigation.
- Accepted late delivery leaves Needs action but remains in Late and retains date warning.
- Repeated fetches/source-only edits do not reopen; later arrival, new unknown, or new overdue condition does.
- Date restored rejects late/unknown/overdue estimates. Merely viewing an issue never resolves it.
- Split Save changes transfers open review context to children; Save and resolve records child dispositions. Parent is excluded from current counts. Unrelated issues remain open.
- Invalid split sums, stale versions, and transaction failures leave deliveries/issues/history unchanged; duplicate submits never duplicate supply or issues.
- Block split of in-transit/received and update of received records.
- Source icon/time is correct; issue resolution and task completion do not alter Last update.
- Preserve filters, expansion, and useful focus after saves; show empty states when the last matching issue is resolved.
- Verify date-only comparison across timezones, direct PO URL refresh, restart persistence, and confirmed reset.

Automated tests demonstrate software behavior, not buyer validation. Record actual checks/findings; do not invent interviews or measured benefits.

## 11. Implementation order
1. Preserve the existing app and Railway setup; migrate persistence and seed data per ARCHITECTURE.md. Scaffold only if the repo is empty.
2. Build Incoming items and PO detail from the same data.
3. Implement arrival updates and derived impact.
4. Implement planned-delivery splitting and quantity checks.
5. Implement inline issue resolution/reopening, history, optional follow-ups, and confirmed reset.
6. Run targeted tests, production build, and Railway deployment checks.

Finish each slice before adding polish. If a requirement threatens the narrow scope, explain the issue and propose the smallest adjustment; do not revive the broader ERP-like app.

## 12. Definition of done
Two connected views; all specified actions actually persist; a reproducible demo; passing critical tests; a working production build; Railway-ready configuration and deployment instructions. Claim a live Railway deployment only after actually verifying it. Deliver a short README with startup, reset, demo steps, limits, and checks performed.

