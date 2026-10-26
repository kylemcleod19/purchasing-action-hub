import { expect, test, type Page } from '@playwright/test';

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;

async function chooseSource(page: Page, source: string) {
  await page.locator('.modal').getByLabel('Source').selectOption({ label: source });
}

test('primary demo: delay opens an issue, split is resolved inline, a worse date reopens it, accepted lateness stays visible', async ({
  page,
  request,
}) => {
  await request.post('/api/demo/reset', { data: { confirm: 'RESET' } });
  const { demoDate } = await (await request.get('/api/meta')).json();
  const D = (n: number) => addDays(demoDate, n);

  // Incoming items: Required dock, Expected arrival, Production start sit side by side.
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Needs action/ })).toHaveAttribute('aria-pressed', 'true');
  const headers = await page.locator('.incoming-table thead th').allInnerTexts();
  const dock = headers.indexOf('Required dock');
  expect(headers.slice(dock, dock + 3)).toEqual(['Required dock', 'Expected arrival', 'Production start']);
  await page.getByRole('button', { name: /All outstanding/ }).click();
  await page.getByLabel('Search PO, part, or supplier').fill('PO-DEMO-01');
  const demoRow = page.locator('.incoming-table > tbody > tr:not(.detail-row)').filter({ hasText: 'PO-DEMO-01' });
  await expect(demoRow).toHaveCount(1);
  await expect(demoRow).toContainText(fmt(D(5)));
  await expect(demoRow).toContainText(fmt(D(7)));
  await expect(demoRow.getByRole('img', { name: 'Initial schedule' })).toBeVisible();

  // 2. Delay to D+16 with Save changes and a blank note: one issue opens inline.
  await demoRow.getByRole('button', { name: 'Update arrival' }).click();
  await page.getByLabel('New expected arrival').fill(D(16));
  await chooseSource(page, 'Supplier email');
  await expect(page.getByLabel('Note (optional)')).toHaveValue('');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/New issue opened: Production conflict, Late/)).toBeVisible();
  await expect(demoRow).toContainText('Open');
  await expect(demoRow.getByRole('img', { name: /^Late: 11 days after required dock date/ })).toBeVisible();
  await expect(demoRow.getByRole('img', { name: /^Production conflict: 9 days after production start/ })).toBeVisible();
  await expect(demoRow.getByRole('img', { name: 'Supplier email' })).toBeVisible();

  // 3. Open the PO (item expanded) and split with Save and resolve issue in the same form.
  await demoRow.getByRole('link', { name: 'PO-DEMO-01' }).click();
  await expect(page.locator('.work-order-callout')).toContainText('WO-DEMO-A');
  await expect(page.locator('.work-order-callout')).toContainText(fmt(D(7)));
  const item = page.locator('.items-table > tbody > tr:not(.detail-row)');
  await expect(item).toHaveCount(1);
  await expect(item.getByRole('img', { name: '1 open issue' })).toBeVisible();
  await expect(page.getByText('Quantities: all deliveries.')).toBeVisible();
  const deliveries = page.locator('.deliveries-table tbody tr');
  await deliveries.first().getByRole('button', { name: 'Split' }).click();
  await page.getByLabel('Delivery 1 quantity').fill('40');
  await page.getByLabel('Delivery 2 quantity').fill('60');
  await page.getByLabel('Delivery 1 expected arrival').fill(D(5));
  await page.getByLabel('Delivery 2 expected arrival').fill(D(16));
  await chooseSource(page, 'Supplier call');
  await expect(page.getByLabel('Outcome')).toHaveValue('split_agreed');
  await page.getByRole('button', { name: 'Save and resolve issue' }).click();
  await expect(page.getByText('Split saved and issue resolved.')).toBeVisible();

  // 4. Ordered 100, Shipped 0, Received 0; two arrivals with quantities; 60 keeps its warning; no action.
  await expect(item.locator('td.num')).toHaveText(['1', '100', '0', '0']);
  const stack = item.locator('.arrival-stack');
  const entries = stack.locator('[data-arrival-for]');
  await expect(entries).toHaveCount(2);
  await expect(entries.filter({ hasText: '(40)' })).toContainText(fmt(D(5)));
  await expect(entries.filter({ hasText: '(60)' })).toContainText(fmt(D(16)));
  await expect(stack.getByRole('img', { name: /^Late:/ })).toHaveCount(1);
  await expect(item.locator('.issue-count')).toHaveCount(0);
  await expect(deliveries).toHaveCount(2);
  const row60 = deliveries.filter({ has: page.locator('td.num', { hasText: /^60$/ }) });
  await expect(row60).toContainText('Resolved');

  // 5. Move the 60 to D+18: a new issue opens; accept the delay inline without changing the date.
  await row60.getByRole('button', { name: 'Update arrival' }).click();
  await page.getByLabel('New expected arrival').fill(D(18));
  await chooseSource(page, 'Supplier call');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(/New issue opened/)).toBeVisible();
  await expect(row60).toContainText('Open');
  await row60.getByRole('button', { name: 'Resolve' }).click();
  await page.getByRole('button', { name: 'Accept delay and resolve' }).click();
  await expect(page.getByText('Issue resolved: Accepted delay.')).toBeVisible();
  await expect(row60).toContainText('Resolved');
  await expect(row60.getByRole('img', { name: /^Production conflict:/ })).toBeVisible();
  const lastUpdate = await row60.locator('.last-update').getAttribute('title');

  // 6. Complete a reminder: dates, Last update, and resolution unchanged.
  await page.getByRole('tab', { name: /Follow-ups/ }).click();
  await expect(page.locator('.work-order-callout')).toContainText(fmt(D(7)));
  await page.getByRole('button', { name: 'Add reminder' }).click();
  await page.getByLabel('Reminder', { exact: true }).fill('Ask about expediting the 60.');
  await page.locator('.modal').getByRole('button', { name: 'Add reminder' }).click();
  await expect(page.getByText('Reminder added.')).toBeVisible();
  await page.locator('tbody tr').filter({ hasText: 'expediting the 60' }).getByRole('button', { name: 'Complete reminder' }).click();
  await page.locator('.modal').getByRole('button', { name: 'Complete reminder' }).click();
  await expect(page.getByText('Reminder completed.')).toBeVisible();
  await page.getByRole('tab', { name: /Deliveries/ }).click();
  await expect(row60).toContainText('Resolved');
  expect(await row60.locator('.last-update').getAttribute('title')).toBe(lastUpdate);

  // Filters combine; Needs action is now empty; Resolved issues keeps the item; totals unchanged.
  await page.getByRole('button', { name: 'Needs action' }).click();
  await expect(page.getByText('No deliveries on this PO match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Resolved issues' }).click();
  await page.getByRole('button', { name: 'Not shipped' }).click();
  await expect(item.locator('td.num')).toHaveText(['1', '100', '0', '0']);
  await page.getByRole('button', { name: 'In transit' }).click();
  await expect(page.getByText('No deliveries on this PO match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Not shipped' }).click();

  // Refresh keeps state and filters.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Resolved issues' })).toHaveAttribute('aria-pressed', 'true');
  await expect(row60).toContainText(fmt(D(18)));
  await expect(row60).toContainText('Resolved');

  // Accepted lateness stays in Incoming items' Late view but not Needs action.
  await page.goto('/');
  await page.getByLabel('Search PO, part, or supplier').fill('PO-DEMO-01');
  await expect(page.getByText('No deliveries need action with these filters.')).toBeVisible();
  await page.getByRole('button', { name: /^Late/ }).click();
  await expect(page.locator('.incoming-table > tbody > tr:not(.detail-row)')).toHaveCount(1);
});

test('a 10-item PO is one table; arrivals show at most two dates with +N; hidden issues still count', async ({ page, request }) => {
  const { rows } = await (await request.get('/api/incoming')).json();
  const lines = new Map<number, Set<number>>();
  for (const r of rows) lines.set(r.poId, (lines.get(r.poId) ?? new Set()).add(r.poLineId));
  const poId = [...lines].find(([, l]) => l.size === 10)![0];
  // Give one planned item three deliveries with an open issue on each (Save changes split).
  const target = rows.find((r: { poId: number; state: string; quantity: number }) => r.poId === poId && r.state === 'planned' && r.quantity >= 6);
  const { demoDate } = await (await request.get('/api/meta')).json();
  await request.patch(`/api/deliveries/${target.deliveryId}`, {
    data: { expectedArrival: addDays(target.productionStart, 3), source: 'supplier_email', version: target.version },
  });
  const third = Math.floor(target.quantity / 3);
  await request.post(`/api/deliveries/${target.deliveryId}/split`, {
    data: {
      version: target.version + 1,
      source: 'supplier_call',
      parts: [
        { quantity: third, expectedArrival: addDays(demoDate, 2) },
        { quantity: third, expectedArrival: addDays(demoDate, 3) },
        { quantity: target.quantity - 2 * third, expectedArrival: null },
      ],
    },
  });

  await page.goto(`/purchase-orders/${poId}`);
  const items = page.locator('.items-table > tbody > tr:not(.detail-row)');
  await expect(items).toHaveCount(10);
  await expect(page.locator('.items-table')).toHaveCount(1);
  await expect(page.locator('.deliveries-table')).toHaveCount(0);

  const item = items.filter({ hasText: target.partNumber }).first();
  await expect(item.locator('.arrival-stack > div')).toHaveCount(2);
  await expect(item.getByRole('img', { name: '3 open issues' })).toBeVisible();
  // All three have open issues, so they sort by date and the unknown one is behind +1.
  await expect(item.locator('[data-arrival-for]')).toHaveText([new RegExp(fmt(addDays(demoDate, 2))), new RegExp(fmt(addDays(demoDate, 3)))]);
  await item.getByRole('button', { name: 'Show 1 more deliveries' }).click();
  await expect(page.locator('.deliveries-table tbody tr')).toHaveCount(3);

  // Keyboard expansion with aria-expanded; several items can stay open.
  const other = items.filter({ hasNot: page.getByText(target.partNumber) }).first();
  await other.getByRole('button', { expanded: false }).first().focus();
  await page.keyboard.press('Enter');
  await expect(other.locator('button.expander')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.deliveries-table')).toHaveCount(2);
});
