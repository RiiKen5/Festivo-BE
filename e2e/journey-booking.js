// Organizer books a vendor -> vendor quotes -> organizer pays advance + balance
// -> messaging -> completion -> review -> vendor reply -> payout details -> admin payout
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');
const step = async (page, name) => { await settle(page); await page.screenshot({ path: `shots/A_${name}.png` }); console.log('✓', name); };

(async () => {
  const browser = await chromium.launch();
  const issues = [];
  const services = (await api('/services')).data;
  const cake = services.find(s => s.serviceName.startsWith('Priya'));
  try {
    // 1. Organizer books Priya
    const org = await session(browser, 'rohit'); issues.push(org.issues);
    await login(org.page, 'rohit@test.in');
    await org.page.goto(`${APP}/services/${cake.slug}`); await settle(org.page);
    await org.page.getByRole('button', { name: 'Request booking' }).click();
    await org.page.locator('app-modal select').first().selectOption({ index: 1 }).catch(async () => {
      const opts = await org.page.locator('app-modal select').first().locator('option').allTextContents();
      throw new Error('event options: ' + opts.join(' | '));
    });
    await org.page.locator('app-modal input[type=number]').first().fill('1800');
    await org.page.locator('app-modal textarea').first().fill('Chocolate truffle, 2kg, "Happy 30th Rohit"');
    await step(org.page, '1_booking_form');
    await org.page.getByRole('button', { name: 'Send request' }).click();
    await org.page.waitForURL(/\/bookings/, { timeout: 8000 });
    await step(org.page, '1_after_booking');

    // 2. Vendor sees the request and confirms with a quote
    const ven = await session(browser, 'priya'); issues.push(ven.issues);
    await login(ven.page, 'priya@test.in');
    await ven.page.goto(`${APP}/bookings`); await step(ven.page, '2_vendor_bookings');
    const bookingId = (await api('/bookings?role=vendor', { token: await tokenFor('priya@test.in') })).data[0]._id;
    await ven.page.goto(`${APP}/bookings/${bookingId}`); await step(ven.page, '2_vendor_booking_detail');
    await ven.page.getByRole('button', { name: /Accept & send price/ }).first().click();
    await ven.page.locator('app-modal input[type=number]').fill('2000');
    await ven.page.getByRole('button', { name: 'Accept booking' }).click();
    await step(ven.page, '2_vendor_confirmed');

    // 3. Organizer pays 30% advance, then the balance
    await org.page.goto(`${APP}/bookings/${bookingId}`); await step(org.page, '3_org_confirmed_view');
    await org.page.getByRole('button', { name: /advance/ }).click();
    await step(org.page, '3_after_advance');
    await org.page.getByRole('button', { name: /^Pay ₹/ }).click();
    await step(org.page, '3_after_balance');
    const b = (await api(`/bookings/${bookingId}`, { token: await tokenFor('rohit@test.in') })).data;
    console.log('   booking payment:', b.paymentStatus, b.pricePaid, '/', b.priceAgreed);

    // 4. Messaging from the booking page
    await ven.page.goto(`${APP}/bookings/${bookingId}`); await settle(ven.page);
    await ven.page.getByRole('button', { name: /Send Message/ }).click(); await settle(ven.page);
    await ven.page.getByPlaceholder('Write a message…').fill('Hi Rohit! Any flavour preference?');
    await ven.page.keyboard.press('Enter'); await step(ven.page, '4_vendor_sent');
    await org.page.goto(`${APP}/messages`); await settle(org.page);
    await org.page.getByText('Priya Cakes').first().click(); await settle(org.page);
    await org.page.getByPlaceholder('Write a message…').fill('Chocolate please!');
    await org.page.keyboard.press('Enter'); await step(org.page, '4_org_replied');
    await ven.page.locator('.bubble', { hasText: 'Chocolate please!' }).waitFor({ timeout: 5000 }).catch(() => {}); // arrives live
    await step(ven.page, '4_vendor_sees_reply');
    console.log('   vendor sees reply:', await ven.page.getByText('Chocolate please!').count() > 0);

    // 5. Organizer completes and reviews
    await org.page.goto(`${APP}/bookings/${bookingId}`); await settle(org.page);
    await org.page.getByRole('button', { name: /Mark as done/ }).first().click(); await step(org.page, '5_completed');
    await org.page.getByRole('button', { name: /Leave a Review/ }).click(); await settle(org.page);
    await step(org.page, '5_review_modal');
    await org.page.locator('app-modal .star, app-modal [class*=star]').nth(4).click().catch(e => console.log('   star click:', e.message.split('\n')[0]));
    await org.page.locator('app-modal textarea').fill('Beautiful cake, delivered on time. Everyone loved it!');
    await org.page.getByRole('button', { name: /Submit/ }).click(); await step(org.page, '5_reviewed');

    // 6. Vendor replies on the service page
    await ven.page.goto(`${APP}/services/${cake.slug}`); await settle(ven.page);
    await ven.page.getByText('Reply to this review').click();
    await ven.page.locator('app-modal textarea').fill('Thank you Rohit, happy birthday!');
    await ven.page.locator('app-modal').getByRole('button', { name: /Reply|Submit|Post/ }).last().click();
    await step(ven.page, '6_vendor_replied');
    console.log('   reply visible:', await ven.page.getByText('Thank you Rohit, happy birthday!').count() > 0);
    console.log('   rating shown:', (await ven.page.locator('text=/\\(\\d+ reviews?\\)/').first().textContent().catch(() => '?')));

    // 7. Vendor sets payout details
    await ven.page.goto(`${APP}/dashboard/earnings`); await settle(ven.page);
    await ven.page.getByLabel('UPI').check();
    await ven.page.locator('input[placeholder="name@okaxis"]').fill('priya@okaxis');
    await ven.page.getByRole('button', { name: /Save payout/ }).click(); await step(ven.page, '7_earnings');

    // 8. Admin pays out and verifies
    const adm = await session(browser, 'admin'); issues.push(adm.issues);
    await login(adm.page, 'admin@test.in');
    await adm.page.goto(`${APP}/admin`); await settle(adm.page);
    await adm.page.getByRole('button', { name: /^Payouts/ }).click(); await step(adm.page, '8_payouts');
    await adm.page.locator('input[placeholder="UTR / reference"]').first().fill('UTR998877');
    await adm.page.getByRole('button', { name: 'Mark sent' }).first().click(); await step(adm.page, '8_paid');
    await adm.page.getByRole('button', { name: /Vendor verification/ }).click(); await settle(adm.page);
    await adm.page.getByRole('button', { name: 'Verify' }).first().click(); await step(adm.page, '8_verified');
    await adm.page.getByRole('button', { name: 'Overview' }).click(); await step(adm.page, '8_overview');
  } catch (e) {
    console.log('✗ FAILED:', e.message.split('\n').slice(0, 3).join(' '));
    process.exitCode = 1;
  }
  await browser.close();
  console.log('\nISSUES:\n' + ([...new Set(issues.flat())].join('\n') || 'none'));
  if (issues.flat().length) process.exitCode = 1;
})();
