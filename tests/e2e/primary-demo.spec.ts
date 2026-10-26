import { expect, test, type Page } from '@playwright/test';

const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

async function fillSourceAndNote(page: Page, source: string, note: string) {
  await page.getByLabel('Source').selectOption({ label: source });
  await page.getByLabel(/^Note/).fill(note);
}

test('arrival update, split, and follow-up keep B late; changes persist after reload', async ({ page, request }) => {
  await request.post('/api/demo/reset', { data: { confirm: 'RESET' } });
  const { demoDate } = await (await request.get('/api/meta')).json();
  const D = (n: number) => addDays(demoDate, n);

  // Incoming items: the demo line starts with no date issue, so it appears under All outstanding.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Incoming items' })).toBeVisible();
  await page.getByRole('button', { name: /All outstanding/ }).click();
  await page.getByLabel('Search PO, part, or supplier').fill('PO-DEMO-01');
  const demoRow = page.locator('tbody tr').filter({ hasText: 'PO-DEMO-01' });
  await expect(demoRow).toHaveCount(1);
  await expect(demoRow).toContainText('No identified date issue');

  // Record the supplier delay to D+16.
  await demoRow.getByRole('button', { name: 'Update arrival' }).click();
  await page.getByLabel('New expected arrival').fill(D(16));
  await fillSourceAndNote(page, 'Supplier email', 'Supplier reports a two-week delay.');
  await page.getByRole('button', { name: 'Save arrival update' }).click();
  await expect(page.getByText('Expected arrival saved.')).toBeVisible();
  await expect(demoRow).toContainText('Late');
  await expect(demoRow).toContainText('2 late');

  // Open the PO and record the agreed split: 40 at D+6 for A, 60 at D+16 for B.
  await demoRow.getByRole('link', { name: 'Open PO' }).click();
  await expect(page.getByRole('heading', { name: 'PO-DEMO-01' })).toBeVisible();
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await page.getByLabel('Delivery 1 quantity', { exact: true }).fill('40');
  await page.getByLabel('Delivery 2 quantity', { exact: true }).fill('60');
  await page.getByLabel('Delivery 1 expected arrival').fill(D(6));
  await page.getByLabel('Delivery 2 expected arrival').fill(D(16));
  await page.getByLabel('Delivery 1 quantity for WO-DEMO-A').fill('40');
  await page.getByLabel('Delivery 2 quantity for WO-DEMO-B').fill('60');
  await fillSourceAndNote(page, 'Supplier call', 'Supplier agreed to ship 40 early for WO-DEMO-A.');
  await page.getByRole('button', { name: 'Save split' }).click();
  await expect(page.getByText(/Split saved/)).toBeVisible();

  const deliveryRows = page.locator('.po-line tbody tr').filter({ has: page.locator('td.num') });
  await expect(deliveryRows).toHaveCount(2);
  const rowA = deliveryRows.filter({ has: page.locator('td.num', { hasText: /^40$/ }) });
  const rowB = deliveryRows.filter({ has: page.locator('td.num', { hasText: /^60$/ }) });
  await expect(rowA).toContainText('No identified date issue');
  await expect(rowB).toContainText('Late');
  await expect(rowB).toContainText('late 60');
  await expect(page.getByText(/Ordered\s+100\s+EA/)).toBeVisible();

  // Add and complete a follow-up without changing B's date.
  await rowB.getByRole('button', { name: 'Add follow-up' }).click();
  await page.getByLabel('What to follow up on').fill('Ask supplier to expedite the remaining 60.');
  await page.getByRole('button', { name: 'Add follow-up' }).last().click();
  await expect(page.getByText('Follow-up added.')).toBeVisible();
  await page.getByRole('tab', { name: /Follow-ups/ }).click();
  const fuRow = page.locator('tbody tr').filter({ hasText: 'expedite the remaining 60' });
  await fuRow.getByRole('button', { name: 'Complete' }).click();
  await page.getByLabel('Completion note (optional)').fill('Supplier cannot expedite.');
  await page.getByRole('button', { name: 'Mark completed' }).click();
  await expect(page.getByText('Follow-up completed.')).toBeVisible();
  await page.getByRole('tab', { name: /Deliveries/ }).click();
  await expect(rowB).toContainText('Late');
  await expect(rowB).toContainText('late 60');

  // Direct reload of the PO URL: the SPA loads and changes persist.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PO-DEMO-01' })).toBeVisible();
  await expect(deliveryRows).toHaveCount(2);
  await expect(rowB).toContainText('late 60');
  await expect(page.getByText('Planned delivery split')).toBeVisible();
});
