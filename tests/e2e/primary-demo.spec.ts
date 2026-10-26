import { expect, test, type Page } from '@playwright/test';

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

async function chooseSource(page: Page, source: string) {
  await page.getByLabel('Source').selectOption({ label: source });
}

test('primary demo: arrival update, split, and follow-up keep the 60 late; changes persist', async ({ page, request }) => {
  await request.post('/api/demo/reset', { data: { confirm: 'RESET' } });
  const { demoDate } = await (await request.get('/api/meta')).json();
  const D = (n: number) => addDays(demoDate, n);

  // Incoming items: work order, and Expected arrival next to Production start.
  await page.goto('/');
  const headers = await page.locator('.data-table thead th').allInnerTexts();
  const arrivalCol = headers.findIndex((h) => h.startsWith('Expected arrival'));
  expect(headers[arrivalCol + 1]).toMatch(/^Production start/);
  expect(headers).toContain('Last update');
  expect(headers.some((h) => /Affected|Earliest/.test(h))).toBe(false);

  await page.getByRole('button', { name: /All outstanding/ }).click();
  await page.getByLabel('Search PO, part, or supplier').fill('PO-DEMO-01');
  const demoRow = page.locator('.data-table > tbody > tr').filter({ hasText: 'PO-DEMO-01' });
  await expect(demoRow).toHaveCount(1);
  await expect(demoRow).toContainText('WO-DEMO-A');
  await expect(demoRow).toContainText(fmt(D(5)));
  await expect(demoRow).toContainText(fmt(D(7)));
  await expect(demoRow).toContainText('No identified date issue');
  await expect(demoRow.getByRole('img', { name: 'Initial PO schedule' })).toBeVisible();

  // Record the supplier delay to D+16 with a blank note.
  await demoRow.getByRole('button', { name: 'Update arrival' }).click();
  await page.getByLabel('New expected arrival').fill(D(16));
  await chooseSource(page, 'Supplier email');
  await expect(page.getByLabel('Note (optional)')).toHaveValue('');
  await page.getByRole('button', { name: 'Save arrival update' }).click();
  await expect(page.getByText('Expected arrival saved.')).toBeVisible();
  await expect(demoRow).toContainText('Late');
  await expect(demoRow).toContainText('9 days after start');
  await expect(demoRow.getByRole('img', { name: 'Supplier email' })).toBeVisible();

  // PO detail: header shows the work order and production start; one item table.
  await demoRow.getByRole('link', { name: 'Open PO' }).click();
  await expect(page.getByRole('heading', { name: 'PO-DEMO-01' })).toBeVisible();
  const callout = page.locator('.work-order-callout');
  await expect(callout).toContainText('WO-DEMO-A');
  await expect(callout).toContainText(fmt(D(7)));
  await expect(page.locator('.po-line, .qty-breakdown')).toHaveCount(0);
  const itemRow = page.locator('.items-table > tbody > tr:not(.detail-row)');
  await expect(itemRow).toHaveCount(1);
  await expect(page.getByText('Item totals (all states)')).toBeVisible();

  // Record the agreed split: 40 at D+6 and 60 at D+16, both for WO-DEMO-A.
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(page.getByText(/work-order|Unassigned|Remaining/i)).toHaveCount(0);
  await page.getByLabel('Delivery 1 quantity').fill('40');
  await page.getByLabel('Delivery 2 quantity').fill('60');
  await page.getByLabel('Delivery 1 expected arrival').fill(D(6));
  await page.getByLabel('Delivery 2 expected arrival').fill(D(16));
  await chooseSource(page, 'Supplier call');
  await page.getByRole('button', { name: 'Save split' }).click();
  await expect(page.getByText(/Split saved/)).toBeVisible();

  const deliveryRows = page.locator('.deliveries-table tbody tr');
  await expect(deliveryRows).toHaveCount(2);
  const rowA = deliveryRows.filter({ has: page.locator('td.num', { hasText: /^40$/ }) });
  const rowB = deliveryRows.filter({ has: page.locator('td.num', { hasText: /^60$/ }) });
  await expect(rowA).toContainText('No identified date issue');
  await expect(rowB).toContainText('Late');
  await expect(rowB.getByRole('img', { name: 'Supplier call' })).toBeVisible();
  // Item totals: ordered 100 = planned 100; late 60.
  await expect(itemRow.locator('td.num')).toHaveText(['1', '100', '100', '0', '0', '60', '0']);

  // Add and complete a follow-up without changing the late date.
  const lastUpdateBefore = await rowB.locator('.last-update').getAttribute('title');
  await rowB.getByRole('button', { name: 'Add follow-up' }).click();
  await page.getByLabel('What to follow up on').fill('Ask supplier to expedite the remaining 60.');
  await page.locator('.modal').getByRole('button', { name: 'Add follow-up' }).click();
  await expect(page.getByText('Follow-up added.')).toBeVisible();
  await page.getByRole('tab', { name: /Follow-ups/ }).click();
  await expect(page.locator('.work-order-callout')).toContainText(fmt(D(7)));
  const fuRow = page.locator('tbody tr').filter({ hasText: 'expedite the remaining 60' });
  await fuRow.getByRole('button', { name: 'Complete' }).click();
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await expect(page.getByText('Follow-up completed.')).toBeVisible();
  await page.getByRole('tab', { name: /Deliveries/ }).click();
  await expect(rowB).toContainText('Late');
  expect(await rowB.locator('.last-update').getAttribute('title')).toBe(lastUpdateBefore);

  // Delivery-state filter hides nonmatching deliveries without changing item totals.
  await page.getByRole('button', { name: 'In transit', exact: true }).click();
  await expect(page.getByText('No in transit deliveries on this PO.')).toBeVisible();
  await page.getByRole('button', { name: 'Planned delivery', exact: true }).click();
  await expect(deliveryRows).toHaveCount(2);
  await expect(itemRow.locator('td.num').nth(1)).toHaveText('100');

  // Direct reload keeps the data and the selected filter.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PO-DEMO-01' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Planned delivery', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(deliveryRows).toHaveCount(2);
  await expect(rowB).toContainText('Late');
  await expect(page.getByText('Planned delivery split')).toBeVisible();
});

test('a 10-item PO renders as one summary table with keyboard-operable accordion rows', async ({ page, request }) => {
  const { rows } = await (await request.get('/api/incoming')).json();
  const counts = new Map<number, Set<number>>();
  for (const r of rows) counts.set(r.poId, (counts.get(r.poId) ?? new Set()).add(r.poLineId));
  const poId = [...counts].find(([, lines]) => lines.size === 10)![0];

  await page.goto(`/purchase-orders/${poId}`);
  const items = page.locator('.items-table > tbody > tr:not(.detail-row)');
  await expect(items).toHaveCount(10);
  await expect(page.locator('.items-table')).toHaveCount(1);
  await expect(page.locator('.deliveries-table')).toHaveCount(0);

  const first = items.nth(0).getByRole('button', { expanded: false });
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(items.nth(0).getByRole('button', { expanded: true })).toBeVisible();
  await items.nth(1).getByRole('button').click();
  await expect(page.locator('.deliveries-table')).toHaveCount(2);
});
