import { expect, test, type Locator, type Page } from '@playwright/test';

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

const modal = (page: Page) => page.locator('.modal');
const incomingRows = (page: Page) => page.locator('.incoming-table > tbody > tr:not(.detail-row)');
const trackingRows = (scope: Page | Locator) => scope.locator('.deliveries-table > tbody > tr:not(.detail-row)');
const manageButton = (scope: Locator) => scope.getByRole('button', { name: /^(Manage|View) deliveries/ });

async function chooseSource(page: Page, source: string) {
  await modal(page).getByLabel('Source').selectOption({ label: source });
}

async function resetDemo(page: Page) {
  await page.request.post('/api/demo/reset', { data: { confirm: 'RESET' } });
  const { demoDate } = await (await page.request.get('/api/meta')).json();
  return (n: number) => addDays(demoDate, n);
}

test('primary demo: one Manage deliveries button per row, inline resolution, accepted lateness keeps warnings', async ({ page }) => {
  const D = await resetDemo(page);

  // Incoming items: no Issue column, one Manage deliveries column, no ordering explanation.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Needs action/ }).first()).toHaveAttribute('aria-pressed', 'true');
  const headers = (await page.locator('.incoming-table thead th').allInnerTexts()).map((h) => h.replace(/[▲▼↕]/g, '').trim());
  expect(headers[1]).toBe('PO · Line item');
  const dock = headers.indexOf('Required dock');
  expect(headers.slice(dock, dock + 3)).toEqual(['Required dock', 'Expected arrival', 'Production start']);
  expect(headers).not.toContain('Issue');
  expect(headers.at(-1)).toBe('Manage deliveries');
  await expect(page.getByText(/not an optimized priority/)).toHaveCount(0);
  await expect(incomingRows(page).first().getByRole('button')).toHaveCount(2); // expander + Manage deliveries

  // Header sorting: ascending, descending, then back to the default order; kept in the URL across reload.
  const qtyHeader = page.locator('.incoming-table thead th').filter({ hasText: 'Qty' });
  const quantities = async () => (await incomingRows(page).locator('td.num').allInnerTexts()).map(Number);
  const defaultOrder = await quantities();
  await qtyHeader.getByRole('button').click();
  await expect(qtyHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page).toHaveURL(/sort=qty&dir=asc/);
  const asc = await quantities();
  expect(asc).toEqual([...asc].sort((a, b) => a - b));
  await qtyHeader.getByRole('button').click();
  await expect(qtyHeader).toHaveAttribute('aria-sort', 'descending');
  expect(await quantities()).toEqual([...asc].sort((a, b) => b - a));
  await page.reload();
  await expect(qtyHeader).toHaveAttribute('aria-sort', 'descending');
  await qtyHeader.getByRole('button').click();
  await expect(qtyHeader).toHaveAttribute('aria-sort', 'none');
  await expect(page).not.toHaveURL(/sort=/);
  expect(await quantities()).toEqual(defaultOrder);

  await page.getByRole('button', { name: /All outstanding/ }).click();
  await page.getByLabel('Search PO, part, or supplier').fill('PO-DEMO-01');
  await expect(page).toHaveURL(/view=outstanding/);
  await expect(page).toHaveURL(/q=PO-DEMO-01/);
  const demoRow = incomingRows(page).filter({ hasText: 'PO-DEMO-01' });
  await expect(demoRow).toHaveCount(1);
  await expect(demoRow).toContainText(fmt(D(5)));
  await expect(demoRow.getByRole('img', { name: 'Initial schedule' })).toBeVisible();
  await expect(manageButton(demoRow)).toHaveAccessibleName('Manage deliveries');
  await expect(manageButton(demoRow)).not.toHaveClass(/needs-action/);

  // 2. Delay to D+16 through the modal with a blank note: one issue opens; the button turns blue.
  await manageButton(demoRow).click();
  await expect(modal(page).getByRole('button', { name: 'Update arrival' })).toHaveAttribute('aria-pressed', 'true');
  await modal(page).getByLabel('New expected arrival').fill(D(16));
  await chooseSource(page, 'Supplier email');
  await expect(modal(page).getByLabel('Note (optional)', { exact: true })).toHaveValue('');
  await modal(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/New issue opened: Production conflict, Late/)).toBeVisible();
  await expect(manageButton(demoRow)).toHaveAccessibleName('Manage deliveries, Needs action');
  await expect(manageButton(demoRow)).toHaveClass(/needs-action/);
  await expect(demoRow.getByRole('img', { name: /^Late: 11 days after required dock date/ })).toHaveCount(1);
  await expect(demoRow.getByRole('img', { name: /^Production conflict: 9 days after production start/ })).toHaveCount(1);
  await expect(demoRow.getByRole('img', { name: 'Supplier email' })).toBeVisible();
  await expect(demoRow).toHaveClass(/\brow-conflict\b/);

  // 3. Open the PO (item expanded) and split with Save and resolve issue in the same modal.
  await demoRow.getByRole('link', { name: 'PO-DEMO-01' }).click();
  await expect(page).toHaveURL(/from=/);
  await expect(page.locator('.work-order-callout')).toContainText('WO-DEMO-A');
  const item = page.locator('.items-table > tbody > tr:not(.detail-row)');
  await expect(item).toHaveCount(1);
  await expect(manageButton(item)).toHaveAccessibleName('Manage deliveries, Needs action');
  await expect(page.getByText('Quantities: all deliveries.')).toBeVisible();
  await expect(page.locator('.deliveries-table caption')).toHaveText('Delivery schedule & tracking');
  const trackHeaders = await page.locator('.deliveries-table thead th').allInnerTexts();
  expect(trackHeaders.slice(1)).toEqual(['Delivery', 'Quantity', 'State', 'Carrier', 'Tracking number', 'Expected / received arrival', 'Last update']);
  await expect(page.locator('.deliveries-table').getByRole('button', { name: /Update|Split|Resolve/ })).toHaveCount(0);

  // History is collapsed on entry; expanding it survives saves and the count grows.
  const historyToggle = page.getByRole('button', { name: /^. Change history \(\d+\)$/ });
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
  const countOf = async () => Number((await historyToggle.innerText()).match(/\((\d+)\)/)![1]);
  const historyBefore = await countOf();
  await historyToggle.click();
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'true');

  await manageButton(item).click();
  await modal(page).getByRole('button', { name: 'Split delivery' }).click();
  await page.getByLabel('Delivery 1 quantity').fill('40');
  await page.getByLabel('Delivery 2 quantity').fill('60');
  await page.getByLabel('Delivery 1 expected arrival').fill(D(5));
  await page.getByLabel('Delivery 2 expected arrival').fill(D(16));
  await chooseSource(page, 'Supplier call');
  await expect(modal(page).getByLabel('Outcome')).toHaveValue('split_agreed');
  await modal(page).getByRole('button', { name: 'Save and resolve issue' }).click();
  await expect(page.getByText('Split saved and issue resolved.')).toBeVisible();
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'true');
  expect(await countOf()).toBeGreaterThan(historyBefore);

  // 4. Ordered 100, Shipped 0, Received 0; two arrivals; the 60 keeps its warning; the button is white.
  await expect(item.locator('td.num')).toHaveText(['1', '100', '0', '0']);
  const entries = item.locator('.arrival-stack [data-arrival-for]');
  await expect(entries).toHaveCount(2);
  await expect(entries.filter({ hasText: '(40)' })).toContainText(fmt(D(5)));
  await expect(entries.filter({ hasText: '(60)' })).toContainText(fmt(D(16)));
  await expect(item.locator('.arrival-stack').getByRole('img', { name: /^Late:/ })).toHaveCount(1);
  await expect(manageButton(item)).toHaveAccessibleName('Manage deliveries');
  await expect(manageButton(item)).not.toHaveClass(/needs-action/);
  const deliveries = trackingRows(page);
  await expect(deliveries).toHaveCount(2);
  const row60 = deliveries.filter({ has: page.locator('td.num', { hasText: /^60$/ }) });
  const row40 = deliveries.filter({ has: page.locator('td.num', { hasText: /^40$/ }) });
  await expect(row60).toHaveClass(/\brow-conflict\b/);
  await expect(row40).not.toHaveClass(/\brow-(late|conflict)\b/);
  await expect(row60.locator('td').nth(4)).toHaveText('—'); // carrier: not shipped
  await expect(row60.locator('td').nth(5)).toHaveText('—'); // tracking: not shipped

  // 5. Move the 60 to D+18 (the modal selects it as the risky delivery); a new issue opens.
  await manageButton(item).click();
  await expect(modal(page).locator('.selected-heading')).toContainText('60 EA');
  await modal(page).getByLabel('New expected arrival').fill(D(18));
  await chooseSource(page, 'Supplier call');
  await modal(page).getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/New issue opened/)).toBeVisible();
  await expect(manageButton(item)).toHaveClass(/needs-action/);
  const lastUpdate = await row60.locator('.last-update').getAttribute('title');

  // Accept current dates resolves without touching dates or Last update.
  await manageButton(item).click();
  await expect(modal(page).locator('.selected-heading')).toContainText('60 EA');
  await expect(modal(page).locator('.issue-section')).toContainText('Needs action');
  await modal(page).getByRole('button', { name: 'Accept current dates' }).click();
  await expect(modal(page).getByLabel('Outcome')).toHaveValue('accepted_delay');
  await modal(page).getByRole('button', { name: 'Accept dates and resolve' }).click();
  await expect(page.getByText('Issue resolved: Accepted delay.')).toBeVisible();
  await expect(manageButton(item)).not.toHaveClass(/needs-action/);
  await expect(row60).toContainText(fmt(D(18)));
  await expect(row60).toHaveClass(/\brow-conflict\b/);
  expect(await row60.locator('.last-update').getAttribute('title')).toBe(lastUpdate);
  await row60.getByRole('button', { name: /Details for delivery/ }).click();
  await expect(page.locator('.deliveries-table .detail-table')).toContainText('Resolved: Accepted delay');

  // 6. Complete a reminder: dates, Last update, and resolution unchanged.
  await page.getByRole('tab', { name: /Follow-ups/ }).click();
  await page.getByRole('button', { name: 'Add reminder' }).click();
  await page.getByLabel('Reminder', { exact: true }).fill('Ask about expediting the 60.');
  await modal(page).getByRole('button', { name: 'Add reminder' }).click();
  await expect(page.getByText('Reminder added.')).toBeVisible();
  await page.locator('tbody tr').filter({ hasText: 'expediting the 60' }).getByRole('button', { name: 'Complete reminder' }).click();
  await modal(page).getByRole('button', { name: 'Complete reminder' }).click();
  await expect(page.getByText('Reminder completed.')).toBeVisible();
  await page.getByRole('tab', { name: /Deliveries/ }).click();
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'true');
  expect(await row60.locator('.last-update').getAttribute('title')).toBe(lastUpdate);

  // Filters combine; Needs action is empty; totals stay full; filters survive reload.
  await page.getByRole('button', { name: 'Needs action' }).click();
  await expect(page.getByText('No deliveries on this PO match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Resolved issues' }).click();
  await page.getByRole('button', { name: 'Not shipped' }).click();
  await expect(item.locator('td.num')).toHaveText(['1', '100', '0', '0']);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resolved issues' })).toHaveAttribute('aria-pressed', 'true');
  await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(row60).toContainText(fmt(D(18)));

  // Back keeps the Incoming view and search; accepted lateness is in Late but not Needs action.
  await page.getByRole('link', { name: '← Incoming items' }).click();
  await expect(page).toHaveURL(/view=outstanding/);
  await expect(page.getByLabel('Search PO, part, or supplier')).toHaveValue('PO-DEMO-01');
  await page.getByRole('button', { name: /Needs action/ }).first().click();
  await expect(page.getByText('No deliveries need action with these filters.')).toBeVisible();
  await page.getByRole('button', { name: /^Late/ }).click();
  await expect(incomingRows(page)).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Late/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(incomingRows(page)).toHaveCount(1);
});

test('modal selection, hidden sibling issues, read-only received rows, and dirty-input confirmation', async ({ page }) => {
  const D = await resetDemo(page);
  const { rows } = await (await page.request.get('/api/incoming')).json();
  const lines = new Map<number, Set<number>>();
  for (const r of rows) lines.set(r.poId, (lines.get(r.poId) ?? new Set()).add(r.poLineId));
  const poId = [...lines].find(([id, l]) => l.size === 10 && rows.some((r: { poId: number; state: string }) => r.poId === id && r.state === 'in_transit'))![0];
  // Give one planned item three deliveries, each with an open issue (Save changes split).
  const target = rows.find((r: { poId: number; state: string; quantity: number }) => r.poId === poId && r.state === 'planned' && r.quantity >= 6);
  await page.request.patch(`/api/deliveries/${target.deliveryId}`, {
    data: { expectedArrival: addDays(target.productionStart, 3), source: 'supplier_email', version: target.version },
  });
  const third = Math.floor(target.quantity / 3);
  const split = await page.request.post(`/api/deliveries/${target.deliveryId}/split`, {
    data: {
      version: target.version + 1,
      source: 'supplier_call',
      parts: [
        { quantity: third, expectedArrival: D(2) },
        { quantity: third, expectedArrival: D(3) },
        { quantity: target.quantity - 2 * third, expectedArrival: null },
      ],
    },
  });
  const [firstChild, secondChild] = (await split.json()).deliveryIds as number[];

  await page.goto(`/purchase-orders/${poId}`);
  const items = page.locator('.items-table > tbody > tr:not(.detail-row)');
  await expect(items).toHaveCount(10);
  // Items default to line order even though one item now has open issues; headers sort and reset.
  const lineNumbers = async () => (await items.locator('td:nth-child(2)').allInnerTexts()).map(Number);
  expect(await lineNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const lineHeader = page.locator('.items-table thead th').filter({ hasText: 'Line' });
  await expect(lineHeader).toHaveAttribute('aria-sort', 'ascending');
  const orderedHeader = page.locator('.items-table thead th').filter({ hasText: 'Ordered' });
  await expect(orderedHeader).toHaveAttribute('title', 'Full item quantity.');
  const orderedQty = async () => (await items.locator('td:nth-child(6)').allInnerTexts()).map(Number);
  await orderedHeader.getByRole('button').click();
  await expect(orderedHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(lineHeader).toHaveAttribute('aria-sort', 'none');
  const asc = await orderedQty();
  expect(asc).toEqual([...asc].sort((x, y) => x - y));
  await orderedHeader.getByRole('button').click();
  await expect(orderedHeader).toHaveAttribute('aria-sort', 'descending');
  expect(await orderedQty()).toEqual([...asc].sort((x, y) => y - x));
  await page.reload();
  await expect(orderedHeader).toHaveAttribute('aria-sort', 'descending');
  await orderedHeader.getByRole('button').click();
  await expect(lineHeader).toHaveAttribute('aria-sort', 'ascending');
  expect(await lineNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await lineHeader.getByRole('button').click();
  await expect(lineHeader).toHaveAttribute('aria-sort', 'descending');
  expect(await lineNumbers()).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  await lineHeader.getByRole('button').click();
  await expect(lineHeader).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('.deliveries-table')).toHaveCount(0);
  const item = items.filter({ hasText: target.partNumber }).first();
  await expect(item.locator('.arrival-stack > div')).toHaveCount(2);
  await expect(item.getByRole('button', { name: 'Show 1 more deliveries' })).toBeVisible();
  // The count covers the delivery hidden behind +1 and any the filters hide.
  await expect(manageButton(item)).toHaveAccessibleName('Manage deliveries, Needs action (3 open issues)');
  await expect(item.locator('.manage-count')).toHaveText('3');

  // Item entry selects the first open issue in displayed order; other deliveries are selectable.
  await manageButton(item).click();
  await expect(modal(page).locator('.delivery-select-table tbody tr')).toHaveCount(3);
  await expect(modal(page).getByRole('radio', { name: `Select delivery #${firstChild}` })).toBeChecked();
  // Dirty input asks before switching; dismissing keeps the selection and the input.
  await modal(page).getByLabel('Note (optional)', { exact: true }).fill('Unsaved note');
  page.once('dialog', (d) => d.dismiss());
  await modal(page).getByRole('radio', { name: `Select delivery #${secondChild}` }).click();
  await expect(modal(page).getByRole('radio', { name: `Select delivery #${firstChild}` })).toBeChecked();
  await expect(modal(page).getByLabel('Note (optional)', { exact: true })).toHaveValue('Unsaved note');
  // Unknown estimate: the acceptance mode is Reviewed / no further action.
  page.once('dialog', (d) => d.accept());
  const unknownChild = modal(page).locator('.delivery-select-table tbody tr').filter({ has: page.getByRole('img', { name: /^Date unknown/ }) });
  await unknownChild.getByRole('radio').click();
  await expect(unknownChild.getByRole('radio')).toBeChecked();
  await expect(modal(page).getByRole('button', { name: 'Reviewed / no further action' })).toBeVisible();
  await expect(modal(page).getByRole('button', { name: 'Accept current dates' })).toHaveCount(0);
  // Cancel closes without saving and returns focus to the item's button.
  await modal(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(modal(page)).toHaveCount(0);
  await expect(manageButton(item)).toBeFocused();
  await expect(manageButton(item)).toHaveAccessibleName('Manage deliveries, Needs action (3 open issues)');

  // Incoming rows select their exact delivery, even when a sibling has an issue too.
  await page.goto('/?view=outstanding');
  await page.getByLabel('Search PO, part, or supplier').fill(target.partNumber);
  const secondRow = page.locator(`.incoming-table tr[data-delivery-id="${secondChild}"]`);
  await expect(manageButton(secondRow)).toHaveAccessibleName('Manage deliveries, Needs action');
  await manageButton(secondRow).click();
  await expect(modal(page).getByRole('radio', { name: `Select delivery #${secondChild}` })).toBeChecked();
  await page.keyboard.press('Escape');

  // Received rows open the same component read-only.
  await page.goto('/?view=received');
  const received = incomingRows(page).first();
  await expect(manageButton(received)).toHaveAccessibleName('View deliveries');
  await manageButton(received).click();
  await expect(modal(page)).toContainText('Received deliveries are read-only');
  await expect(modal(page).getByRole('button', { name: /Update arrival|Split delivery|Accept current dates/ })).toHaveCount(0);
});

test('tracking from the normal seed, destination/program filters, and URL round-trip', async ({ page }) => {
  await resetDemo(page);
  const { rows } = await (await page.request.get('/api/incoming')).json();
  const caseB = rows.find((r: { shipment: { trackingNumber: string } | null }) => r.shipment?.trackingNumber === 'DEMO-TRACK-001');

  // Shared shipment number, split portions, not-shipped remainder.
  await page.goto(`/purchase-orders/${caseB.poId}?item=${caseB.poLineId}`);
  const line1 = trackingRows(page);
  await expect(line1).toHaveCount(2);
  await expect(line1.filter({ hasText: 'DEMO-TRACK-001' })).toContainText('Demo Freight');
  await expect(line1.filter({ hasText: 'Not shipped' }).locator('td').nth(5)).toHaveText('—');
  const line3Id = rows.find((r: { poId: number; lineNo: number }) => r.poId === caseB.poId && r.lineNo === 3).poLineId;
  const line3 = page.locator(`.items-table tr[data-line-id="${line3Id}"]`);
  await line3.locator('button.expander').click();
  const numbers = await page.locator('.deliveries-table .tracking-number').allInnerTexts();
  expect(new Set(numbers.filter((n) => n !== 'DEMO-TRACK-001')).size).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.deliveries-table a')).toHaveCount(0); // never links synthetic tracking numbers

  // The one dispatched delivery without a tracking number.
  const untracked = rows.find((r: { state: string; shipment: { trackingNumber: string | null } | null }) => r.state === 'in_transit' && r.shipment && !r.shipment.trackingNumber);
  await page.goto(`/purchase-orders/${untracked.poId}`);
  await expect(trackingRows(page).first()).toContainText('Tracking unavailable');

  // Destination and Program line: OR within, AND across, counts follow the other filters, URL keeps it.
  await page.goto('/?view=outstanding');
  const allCount = await incomingRows(page).count();
  await page.getByRole('button', { name: /^Destination: All/ }).click();
  const south = page.getByRole('group', { name: 'Destination' }).getByLabel('South Warehouse');
  await south.click();
  await expect(south).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/destination=\d+/);
  // Wait for the filtered table to render before counting.
  await expect.poll(() => incomingRows(page).count()).toBeLessThan(allCount);
  const southCount = await incomingRows(page).count();
  expect(southCount).toBeGreaterThan(0);
  expect(southCount).toBeLessThan(allCount);
  await expect(page.getByRole('button', { name: /All outstanding/ }).locator('.count')).toHaveText(String(southCount));
  await page.getByRole('button', { name: /^Program line: All/ }).click();
  const programs = page.getByRole('group', { name: 'Program line' });
  await programs.getByLabel('Search program line').fill('Program');
  const boxes = programs.getByRole('checkbox');
  await boxes.nth(0).click();
  await expect(boxes.nth(0)).toBeChecked();
  await boxes.nth(1).click();
  await expect(boxes.nth(1)).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: /^Program line: 2 selected/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.getAll('program')).toHaveLength(2);
  const narrowed = await incomingRows(page).count();
  expect(narrowed).toBeLessThanOrEqual(southCount);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Program line: 2 selected/ })).toBeVisible();
  await expect(incomingRows(page)).toHaveCount(narrowed);
  // Unknown values in a stale link are ignored rather than mapped to something else.
  await page.goto('/?view=outstanding&program=Program%20Nowhere');
  await expect(page.getByRole('button', { name: /^Program line: All/ })).toBeVisible();
  await expect(incomingRows(page)).toHaveCount(allCount);
  await page.getByLabel('Search PO, part, or supplier').fill('zzz-no-match');
  await expect(page.getByText('No deliveries match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(incomingRows(page)).toHaveCount(allCount);

  // Overdue but before its dock date: clock icon only, no late warning or tint. Late-only: light tint.
  await page.getByLabel('Search PO, part, or supplier').fill('PO-24110');
  const overdueRow = incomingRows(page).first();
  await expect(overdueRow.getByRole('img', { name: /^Overdue: expected \d+ days? ago/ })).toHaveCount(1);
  await expect(overdueRow.getByRole('img', { name: /^Late:/ })).toHaveCount(0);
  await expect(overdueRow).not.toHaveClass(/\brow-(late|conflict)\b/);
  await page.getByLabel('Search PO, part, or supplier').fill('PO-24108');
  await expect(incomingRows(page).first()).toHaveClass(/\brow-late\b/);
});

const scenarioState = async (page: Page) => (await (await page.request.get('/api/demo/scenarios')).json()) as {
  cases: { steps: { key: string; done: boolean }[]; extras: { key: string; done: boolean }[] }[];
};
const doneKeys = async (page: Page) =>
  (await scenarioState(page)).cases.flatMap((c) => [...c.steps, ...c.extras]).filter((s) => s.done).map((s) => s.key);

test('supplier scenario: purpose and next action up front, read-only emails, progress survives tabs and reload', async ({ page }) => {
  await resetDemo(page);
  await page.goto('/');
  // The automation demo is its own page, linked beside Incoming items.
  const nav = page.getByRole('navigation');
  await expect(nav.getByRole('link')).toHaveText(['Incoming items', 'Automation demo']);
  await nav.getByRole('link', { name: 'Automation demo' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Automated Supplier Follow-Up & Shipment Tracking');
  await expect(page.getByText('See how supplier replies and carrier updates become delivery estimates and purchasing actions.')).toBeVisible();
  await expect(page).toHaveURL(/\/demo-scenarios$/);
  await expect(page.getByText('Simulated emails and carrier events; no messages are sent.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Supplier follow-up' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Request arrival confirmations, process a partial reply, and escalate unanswered items to purchasing.')).toBeInViewport();

  const toolbar = page.locator('.scenario-toolbar');
  const primary = toolbar.locator('button.primary');
  const current = toolbar.locator('[aria-current="step"]');
  await expect(current).toContainText('Request confirmation');
  await expect(primary).toHaveText('Simulate sending request');
  await expect(primary).toBeInViewport();
  const items = page.locator('.supplier-items tbody tr');
  await expect(items).toHaveCount(8);
  await expect(items.first()).toContainText('Selected');
  await page.getByText(/Why other items weren’t contacted/).click();
  await expect(page.locator('.scenario-section').first()).toContainText('Usable carrier tracking');

  // Email previews are read-only and labeled as samples.
  await toolbar.getByRole('button', { name: 'Preview request email' }).click();
  await expect(modal(page)).toContainText('Preview: this request has not been sent.');
  await expect(modal(page).locator('.email-headers')).toContainText('orders@kestrel-precision-machining.example.com');
  await expect(modal(page).locator('.message-body')).toContainText('Please confirm the expected arrival dates at our warehouse below');
  await modal(page).locator('.form-actions').getByRole('button', { name: 'Close' }).click();
  await toolbar.getByRole('button', { name: 'Preview sample reply' }).click();
  await expect(modal(page)).toContainText('Sample reply: a seeded fixture, shown before processing. It has not arrived.');
  await expect(modal(page).locator('.message-body')).toContainText('should ship Friday');
  await page.keyboard.press('Escape');
  expect(await doneKeys(page)).toEqual([]);

  await primary.click();
  await expect(toolbar.getByRole('status')).toContainText('for 8 items');
  await expect(current).toContainText('Process partial reply');
  await expect(primary).toHaveText('Process supplier reply');
  await expect(toolbar.getByRole('button', { name: 'View sent email' })).toBeVisible();
  await expect(items.first()).toContainText('No reply');

  // A failed operation reports the error and does not advance the step.
  await page.route('**/api/demo/supplier-replies/**', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Simulated failure."}' }));
  await primary.click();
  await expect(toolbar.getByRole('alert')).toContainText('Simulated failure. Nothing was changed.');
  await expect(current).toContainText('Process partial reply');
  await page.unroute('**/api/demo/supplier-replies/**');

  await primary.click();
  await expect(toolbar.getByRole('status')).toContainText('6 updated, 1 need clarification, 1 not mentioned');
  await expect(current).toContainText('Reach follow-up deadline');
  const statuses = await page.locator('.supplier-items tbody tr td:nth-child(6)').allInnerTexts();
  expect(statuses.filter((s) => s === 'Confirmed')).toHaveLength(4);
  expect(statuses.filter((s) => s === 'Revised')).toHaveLength(2);
  expect(statuses.filter((s) => s === 'Needs clarification')).toHaveLength(1);
  expect(statuses.filter((s) => s === 'No reply')).toHaveLength(1);
  await expect(page.locator('.supplier-items').getByRole('link', { name: /^Delivery issue:/ })).toHaveCount(2);
  await expect(page.getByTestId('supplier-summary')).toHaveText('Confirmed 4 · Revised 2 · Needs clarification 1 · No reply 1');
  const before = await doneKeys(page);
  await page.locator('.results-heading').getByRole('button', { name: 'View supplier reply' }).click();
  await expect(modal(page)).toContainText('Simulated email. Nothing was sent or received.');
  await expect(modal(page).locator('.email-headers')).toContainText('Kestrel Precision Machining');
  await page.keyboard.press('Escape');
  expect(await doneKeys(page)).toEqual(before);

  // Tab switches and reload restore progress from the server; nothing runs.
  await page.getByRole('tab', { name: 'Shipment tracking' }).click();
  await expect(page).toHaveURL(/scenario=carrier/);
  await expect(current).toContainText('Apply carrier delay');
  await page.getByRole('tab', { name: 'Supplier follow-up' }).click();
  await expect(current).toContainText('Reach follow-up deadline');
  await page.reload();
  await expect(current).toContainText('Reach follow-up deadline');
  expect(await doneKeys(page)).toEqual(before);

  await expect(primary).toHaveText(/^Advance clock to /);
  await primary.click();
  await expect(toolbar.getByRole('status')).toContainText('1 call tasks created');
  await expect(page.locator('.supplier-items').getByRole('link', { name: /^Call task #\d+$/ })).toHaveCount(2);
  await expect(toolbar.getByRole('link', { name: /Call task #\d+ · Open/ })).toBeVisible();
  await expect(primary).toHaveText('Process clarification email');
  await primary.click();
  await expect(toolbar.getByRole('status')).toContainText('2 updated');
  await expect(toolbar).toContainText('All steps complete');
  await expect(page.getByTestId('supplier-summary')).toContainText('Answered by supplier');
  await toolbar.getByRole('button', { name: 'View clarification email' }).click();
  await expect(modal(page).locator('.message-body')).toContainText('Following up on the two open items');
  await page.keyboard.press('Escape');

  // The past-date confirmation stays available under Additional test cases.
  await page.getByText('Additional test cases').click();
  await page.getByRole('button', { name: 'Process past-date confirmation' }).click();
  await expect(toolbar.getByRole('status')).toContainText('1 updated');

  // The PO shows the same correspondence, with the email in the panel.
  await page.goto('/?q=PO-24116');
  await incomingRows(page).getByRole('link', { name: 'PO-24116' }).first().click();
  await page.getByRole('button', { name: /Supplier correspondence \(1\)/ }).click();
  await expect(page.locator('.correspondence')).toContainText('PO-24105 line 1');
  await page.locator('.correspondence').getByRole('button', { name: 'View sent email' }).click();
  await expect(modal(page)).toContainText('Simulated email. Nothing was sent or received.');
});

test('carrier scenario: delay reaches linked rows only; carrier Delivered stays separate from warehouse Received', async ({ page }) => {
  const D = await resetDemo(page);
  await page.goto('/demo-scenarios?scenario=carrier');
  await expect(page.getByRole('tab', { name: 'Shipment tracking' })).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByText('Apply a shipment delay to its linked items while preserving unshipped quantities and warehouse receipt status.'),
  ).toBeInViewport();
  const toolbar = page.locator('.scenario-toolbar');
  const primary = toolbar.locator('button.primary');
  const status = toolbar.getByRole('status');
  await expect(primary).toHaveText(`Apply carrier delay (ETA ${fmt(D(6))})`);
  await expect(primary).toBeInViewport();
  await expect(page.locator('.carrier-context')).toContainText('DEMO-TRACK-001');
  const received = await page.getByTestId('warehouse-received').innerText();

  const rows = page.locator('.carrier-items tbody tr');
  const shipped = rows.filter({ hasText: 'SH-DEMO-01' });
  const remainder = rows.filter({ hasText: 'Not shipped' });
  await expect(shipped).toHaveCount(3);
  await expect(remainder).toHaveCount(1);

  await primary.click();
  await expect(status).toContainText('3 deliveries updated');
  for (const row of await shipped.all()) {
    await expect(row.locator('td').nth(3)).toHaveText(fmt(D(1)));
    await expect(row.locator('td').nth(4)).toContainText(fmt(D(6)));
  }
  await expect(remainder.locator('td').nth(3)).toHaveText('—');
  await expect(remainder.locator('td').nth(4)).toContainText(fmt(D(2)));
  await expect(page.getByTestId('carrier-summary')).toContainText('open issues 3');

  await expect(primary).toHaveText(`Apply further delay (ETA ${fmt(D(8))})`);
  await primary.click();
  await expect(status).toContainText('3 deliveries updated');
  await expect(primary).toHaveText(/^Advance clock to /);
  await primary.click();
  await expect(status).toContainText('Demo clock is now');
  await expect(primary).toHaveText('Record carrier delivery');
  await primary.click();
  await expect(status).toContainText('applied');
  await expect(toolbar).toContainText('All steps complete');
  await expect(page.locator('.carrier-context')).toContainText('Delivered / receipt pending');
  await expect(page.getByTestId('warehouse-received')).toHaveText(received);
  await expect(shipped.first()).toContainText('Carrier: Delivered / receipt pending · Warehouse: Not received');
  await expect(remainder.locator('td').nth(4)).toContainText(fmt(D(2)));

  // Secondary checks remain available out of the main walkthrough.
  await page.getByText('Additional test cases').click();
  await page.getByRole('button', { name: 'Replay duplicate event' }).click();
  await expect(status).toContainText('Duplicate event ID; nothing changed.');
  await page.getByRole('button', { name: 'Process older event' }).click();
  await expect(status).toContainText('ignored');
  await page.getByText(/Carrier event log/).click();
  await expect(page.locator('.scenario-section').filter({ hasText: 'Carrier event log' })).toContainText('ignored');

  const { rows: incoming } = await (await page.request.get('/api/incoming')).json();
  const line1 = incoming.find((r: { shipment: { trackingNumber: string } | null; lineNo: number }) => r.shipment?.trackingNumber === 'DEMO-TRACK-001' && r.lineNo === 1);
  await page.goto(`/purchase-orders/${line1.poId}?item=${line1.poLineId}`);
  const item = page.locator('.items-table > tbody > tr.expanded');
  await expect(item.locator('td.num')).toHaveText(['1', '50', '30', '0']);
  await expect(manageButton(item)).toHaveClass(/needs-action/);
});
