// Secondary actions: vendor manages listings, cancels a paid booking;
// organizer edits/unpublishes; attendee changes RSVP and cancels a ticket;
// notifications; favorites; filters; legal pages
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');
const step = async (page, name) => { await settle(page); await page.screenshot({ path: `shots/D_${name}.png`, fullPage: true }); console.log('✓', name); };

(async () => {
  const browser = await chromium.launch();
  const issues = [];
  try {
    const rohitT = await tokenFor('rohit@test.in'), priyaT = await tokenFor('priya@test.in');
    const cake = (await api('/services')).data.find(s => s.serviceName.startsWith('Priya'));
    const events = (await api('/events/my-events', { token: rohitT })).data;
    const mixer = events.find(e => e.title === 'Pune Startup Mixer');
    const paidEv = events.find(e => e.entryFee > 0);

    // Setup via API: confirmed + paid booking for vendor-cancel test
    const b = await api('/bookings', { token: rohitT, method: 'POST', body: { eventId: mixer._id, serviceId: cake._id } });
    await api(`/bookings/${b.data._id}/confirm`, { token: priyaT, method: 'POST', body: {} });

    // 1. Organizer pays, vendor cancels -> full refund shown
    const org = await session(browser, 'rohit'); issues.push(org.issues);
    await login(org.page, 'rohit@test.in');
    await org.page.goto(`${APP}/bookings/${b.data._id}`); await settle(org.page);
    await org.page.getByRole('button', { name: /^Pay ₹/ }).click(); await settle(org.page);
    const ven = await session(browser, 'priya'); issues.push(ven.issues);
    await login(ven.page, 'priya@test.in');
    await ven.page.goto(`${APP}/bookings/${b.data._id}`); await settle(ven.page);
    await ven.page.getByRole('button', { name: /Cancel booking|Decline request/ }).first().click();
    await ven.page.locator('app-modal textarea').fill('Oven broke down, very sorry');
    await ven.page.locator('app-modal').getByRole('button', { name: 'Cancel Booking' }).click();
    await step(ven.page, '1_vendor_cancelled');
    const after = (await api(`/bookings/${b.data._id}`, { token: rohitT })).data;
    console.log('   after vendor cancel:', after.status, after.paymentStatus, 'refunded', after.refundedAmount);

    // 2. Vendor: my services -> pause listing, edit price
    await ven.page.goto(`${APP}/dashboard/my-services`); await step(ven.page, '2_my_services');
    const toggle = ven.page.locator('input[type=checkbox]').first();
    if (await toggle.count()) { await toggle.locator('xpath=..').click(); await settle(ven.page); }
    const paused = (await api(`/services/${cake._id}`)).data;
    console.log('   listing active after toggle:', paused.isActive);
    await ven.page.goto(`${APP}/services/edit/${cake._id}`); await settle(ven.page);
    if (ven.page.url().includes('/edit')) {
      await ven.page.locator('app-input[formcontrolname=basePrice] input').fill('2200');
      await ven.page.locator('button[type=submit]').click(); await settle(ven.page, 1200);
      console.log('   price after edit:', (await api(`/services/${cake._id}`)).data.basePrice);
    } else console.log('   no edit route at', ven.page.url());

    // 3. Organizer edits and unpublishes an event
    await org.page.goto(`${APP}/events/${mixer.slug}/edit`); await settle(org.page);
    await org.page.locator('app-input[formcontrolname=title] input').fill('Pune Startup Mixer #2');
    await org.page.locator('button[type=submit]').click(); await settle(org.page, 1200);
    await step(org.page, '3_edited');
    await org.page.getByRole('button', { name: 'Unpublish' }).click(); await step(org.page, '3_unpublished');
    console.log('   public list still shows mixer:', (await api('/events')).data.some(e => e.title.startsWith('Pune Startup')));

    // 4. Attendee: RSVP maybe -> change to going -> cancel; ticket buy + cancel refund
    const att = await session(browser, 'asha'); issues.push(att.issues);
    await login(att.page, 'asha@test.in');
    await att.page.goto(`${APP}/events/${paidEv.slug}`); await settle(att.page);
    await att.page.getByRole('button', { name: /Buy Ticket/ }).click();
    await att.page.getByRole('button', { name: 'Continue to Payment' }).click(); await settle(att.page);
    await att.page.getByRole('button', { name: 'Cancel Ticket' }).click(); await step(att.page, '4_ticket_cancelled');
    const pays = (await api('/payments/mine?role=payer', { token: await tokenFor('asha@test.in') })).data;
    console.log('   ticket payment after cancel:', pays[0]?.status, 'refunded', pays[0]?.refundedAmount);

    // 5. Notifications: open one, mark all read
    await att.page.goto(`${APP}/notifications`); await settle(att.page);
    await ven.page.goto(`${APP}/notifications`); await settle(ven.page);
    await step(ven.page, '5_vendor_notifications');
    await ven.page.getByText(/Mark all/i).first().click();
    await settle(ven.page);
    console.log('   unread after mark all:', (await api('/notifications/unread-count', { token: priyaT })).data.unreadCount);

    // 6. Favorites, filters, legal pages
    await att.page.goto(`${APP}/services/${cake.slug}`); await settle(att.page);
    await att.page.goto(`${APP}/events`); await settle(att.page);
    await att.page.getByText('This Week', { exact: false }).first().click().catch(() => {});
    await step(att.page, '6_events_this_week');
    for (const p of ['terms', 'privacy', 'refund-policy', 'contact']) {
      await att.page.goto(`${APP}/${p}`); await settle(att.page);
    }
    await step(att.page, '6_contact');
  } catch (e) {
    console.log('✗ FAILED:', e.message.split('\n').slice(0, 3).join(' '));
  }
  await browser.close();
  console.log('\nISSUES:\n' + ([...new Set(issues.flat())].join('\n') || 'none'));
})();
