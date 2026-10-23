// Organizer creates a private event, plans it, invites a guest; attendee buys a
// paid ticket; organizer checks guests in; organizer cancels with refunds.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');
const step = async (page, name) => { await settle(page); await page.screenshot({ path: `shots/B_${name}.png`, fullPage: true }); console.log('✓', name); };
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().split('T')[0];

(async () => {
  const browser = await chromium.launch();
  const issues = [];
  try {
    const org = await session(browser, 'rohit'); issues.push(org.issues);
    await login(org.page, 'rohit@test.in');

    // 1. Create a private event through the form
    await org.page.goto(`${APP}/events/create`); await settle(org.page);
    const f = (name) => org.page.locator(`app-input[formcontrolname=${name}] input`);
    await f('title').fill('Asha Farewell Dinner');
    await org.page.locator('.type-option').nth(5).click();
    await org.page.locator('textarea[formcontrolname=description]').fill('A farewell dinner for Asha before she moves to Bangalore.');
    await f('date').fill(inDays(15));
    await f('time').fill('20:00');
    await f('locationName').fill('The Flour Works');
    await f('city').fill('Pune');
    await f('address').fill('Kalyani Nagar, Pune');
    await f('expectedGuests').fill('12');
    const isPublic = org.page.locator('input[formcontrolname=isPublic]');
    if (await isPublic.isChecked()) await isPublic.locator('xpath=..').click();
    await step(org.page, '1_create_form');
    await org.page.locator('button[type=submit]').click();
    await org.page.waitForURL(/\/events\/asha-farewell/, { timeout: 8000 });
    await step(org.page, '1_created');

    // 2. Checklist
    await org.page.getByRole('button', { name: 'Add Task' }).click();
    await org.page.locator('app-modal input').first().fill('Book a cake');
    await org.page.locator('app-modal select').first().selectOption({ index: 1 });
    await org.page.locator('app-modal').getByRole('button', { name: /Save|Add/ }).last().click();
    await settle(org.page);
    await org.page.locator('.task-checkbox').first().click();
    await step(org.page, '2_tasks');

    // 3. Publish privately and get the invite link
    await org.page.getByRole('button', { name: 'Publish' }).click(); await step(org.page, '3_published');
    const mine = (await api('/events/my-events', { token: await tokenFor('rohit@test.in') })).data;
    const farewell = mine.find(e => e.title === 'Asha Farewell Dinner');
    console.log('   status/public:', farewell.status, farewell.isPublic, 'invite:', !!farewell.inviteCode);

    // 4. Attendee: blocked without the link, can RSVP with it
    const att = await session(browser, 'asha'); issues.push(att.issues);
    await login(att.page, 'asha@test.in');
    await att.page.goto(`${APP}/events/${farewell.slug}`); await settle(att.page);
    console.log('   stranger sees private event:', await att.page.getByText('Asha Farewell Dinner').count() > 0);
    att.issues.length = 0; // the 404 above is expected
    await att.page.goto(`${APP}/events/${farewell.slug}?invite=${farewell.inviteCode}`); await settle(att.page);
    await att.page.getByRole('button', { name: /RSVP Now/ }).click();
    await att.page.locator('.rsvp-option').first().click();
    await att.page.locator('.guests-btn').last().click();
    await att.page.getByRole('button', { name: 'Confirm RSVP' }).click();
    await step(att.page, '4_rsvped');

    // 5. Attendee buys a paid ticket
    const paid = (await api('/events')).data.find(e => e.entryFee > 0);
    await att.page.goto(`${APP}/events/${paid.slug}`); await settle(att.page);
    await att.page.getByRole('button', { name: /Buy Ticket/ }).click();
    await att.page.getByRole('button', { name: 'Continue to Payment' }).click();
    await step(att.page, '5_ticket');
    const code = (await att.page.locator('.code-value').textContent().catch(() => '')).trim();
    console.log('   check-in code shown:', code || 'NONE');
    await att.page.goto(`${APP}/dashboard`); await step(att.page, '5_attendee_dashboard');

    // 6. Organizer checks the guest in by code
    await org.page.goto(`${APP}/events/${paid.slug}`); await settle(org.page);
    await org.page.locator('input[placeholder="Check-in code"]').fill(code);
    await org.page.getByRole('button', { name: 'Check in' }).first().click();
    await step(org.page, '6_checked_in');
    console.log('   checked in shown:', await org.page.getByText(/Checked in/).count() > 0);

    // 7. Organizer cancels the paid event -> refunds + notifications
    await org.page.getByRole('button', { name: 'Cancel event' }).first().click();
    await org.page.locator('app-modal textarea').last().fill('Venue flooded, so sorry!');
    await org.page.locator('app-modal').getByRole('button', { name: 'Cancel event' }).click();
    await step(org.page, '7_cancelled');
    await att.page.goto(`${APP}/notifications`); await step(att.page, '7_attendee_notifications');
    console.log('   attendee notified:', await att.page.getByText(/cancelled/i).count() > 0);
  } catch (e) {
    console.log('✗ FAILED:', e.message.split('\n').slice(0, 3).join(' '));
  }
  await browser.close();
  console.log('\nISSUES:\n' + ([...new Set(issues.flat())].join('\n') || 'none'));
})();
