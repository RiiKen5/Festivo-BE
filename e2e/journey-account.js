// Sign up -> verify -> vendor listing with uploads -> profile/avatar ->
// change password -> forgot/reset password -> search and filters
const { chromium, APP, API, session, login, settle, pickCity } = require('./lib');
const step = async (page, name) => { await settle(page); await page.screenshot({ path: `shots/C_${name}.png`, fullPage: true }); console.log('✓', name); };

(async () => {
  // A generated photo for the upload steps
  await require('../node_modules/sharp')({ create: { width: 1200, height: 800, channels: 3, background: '#f59e0b' } })
    .jpeg().toFile('photo.jpg');
  const browser = await chromium.launch();
  const issues = [];
  try {
    const { page, issues: iss } = await session(browser, 'meera'); issues.push(iss);

    // 1. Sign up as a vendor
    await page.goto(`${APP}/auth/register`); await settle(page);
    const f = (n) => page.locator(`app-input[formcontrolname=${n}] input`);
    await f('name').fill('Meera Decor');
    await f('email').fill('meera@test.in');
    await f('phone').fill('9876500009');
    await pickCity(page, 'Pune');
    await f('password').fill('Password123!');
    await page.locator('.user-type-option').nth(1).click();
    await page.locator('input[formcontrolname=acceptTerms]').check();
    const regResponse = page.waitForResponse(r => r.url().endsWith('/auth/register'));
    await page.locator('button[type=submit]').click();
    const reg = await (await regResponse).json();
    await step(page, '1_registered');

    // 2. Verify email from the link
    const verifyUrl = reg.data._dev.emailVerificationUrl;
    await page.goto(verifyUrl); await step(page, '2_verified');
    await page.goto(`${APP}/dashboard`); await settle(page);
    console.log('   logged in after verify:', !page.url().includes('/auth/login'));

    // 3. Create a service with uploaded photos
    await page.goto(`${APP}/services/create`); await step(page, '3_service_form');
    await page.locator('app-input[formcontrolname=serviceName] input').fill('Meera Balloon & Floral Decor');
    await page.locator('select[formcontrolname=category]').selectOption('decor');
    await page.locator('textarea[formcontrolname=description]').fill('Balloon arches, floral backdrops and table decor for birthdays and baby showers.');
    await page.locator('app-input[formcontrolname=basePrice] input').fill('3500');
    await page.locator('select[formcontrolname=priceUnit]').selectOption('per_event');
    const cityInput = page.locator('app-city-select[formcontrolname=city] input');
    if (!(await cityInput.inputValue())) await pickCity(page, 'Pune');
    await page.locator('app-image-upload input[type=file]').first().setInputFiles('photo.jpg');
    await page.locator('app-image-upload input[type=file]').nth(1).setInputFiles(['photo.jpg', 'photo.jpg']);
    await page.waitForTimeout(2500);
    await step(page, '3_service_filled');
    await page.locator('button[type=submit]').click();
    await page.waitForTimeout(1500); await step(page, '3_service_created');
    const mine = await (await fetch(`${API}/services?search=Meera`)).json();
    const svc = mine.data.find(s => s.serviceName.startsWith('Meera'));
    console.log('   service listed:', !!svc, 'cover:', !!svc?.coverImage, 'portfolio:', svc?.portfolioImages?.length);

    // 4. Profile: bio + avatar
    await page.goto(`${APP}/profile`); await settle(page);
    await page.locator('textarea[formcontrolname=bio]').fill('Decorator in Pune for 6 years.');
    await page.getByRole('button', { name: /Save|Update Profile/ }).first().click(); await settle(page);
    const avatarInput = page.locator('input[type=file]').first();
    if (await avatarInput.count()) { await avatarInput.setInputFiles('photo.jpg'); await page.waitForTimeout(2000); }
    await step(page, '4_profile');

    // 5. Change password, log out, log in with the new one
    await page.getByText('Security').first().click(); await settle(page);
    await page.locator('[formcontrolname=currentPassword] input, input[formcontrolname=currentPassword]').first().fill('Password123!');
    await page.locator('[formcontrolname=newPassword] input, input[formcontrolname=newPassword]').first().fill('NewPassword456!');
    await page.locator('[formcontrolname=confirmPassword] input, input[formcontrolname=confirmPassword]').first().fill('NewPassword456!');
    await page.getByRole('button', { name: 'Update Password' }).click(); await step(page, '5_password_changed');
    await page.goto(`${APP}/dashboard`); await page.waitForTimeout(500);
    await page.evaluate(() => localStorage.clear());
    await login(page, 'meera@test.in', 'NewPassword456!'); console.log('   login with new password: ok');

    // 6. Forgot password -> reset link -> log in
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${APP}/auth/forgot-password`); await settle(page);
    await page.locator('app-input[formcontrolname=email] input').fill('meera@test.in');
    const fpResponse = page.waitForResponse(r => r.url().endsWith('/auth/forgot-password'));
    await page.locator('button[type=submit]').click();
    const fp = await (await fpResponse).json();
    await step(page, '6_forgot_sent');
    await page.goto(fp.data._dev.resetUrl); await settle(page);
    await page.locator('app-input[formcontrolname=password] input').fill('Reset789!Pass');
    await page.locator('app-input[formcontrolname=confirmPassword] input').fill('Reset789!Pass');
    await page.locator('button[type=submit]').click(); await step(page, '6_reset_done');
    await page.evaluate(() => localStorage.clear());
    await login(page, 'meera@test.in', 'Reset789!Pass'); console.log('   login after reset: ok');

    // 7. Discovery: search + filters
    await page.goto(`${APP}/services?category=decor`); await step(page, '7_services_decor');
    console.log('   decor filter shows Meera:', await page.getByText('Meera Balloon').count() > 0);
    await page.goto(`${APP}/events`); await settle(page);
    const search = page.locator('input[type=search], input[placeholder*=earch]').first();
    await search.fill('Rooftop'); await search.press('Enter'); await step(page, '7_events_search');
    console.log('   search finds rooftop:', await page.getByText('Sunset Rooftop Party').count() > 0, '| hides mixer:', await page.getByText('Pune Startup Mixer').count() === 0);

    // 8. Notifications page
    await page.goto(`${APP}/notifications`); await step(page, '8_notifications');
  } catch (e) {
    console.log('✗ FAILED:', e.message.split('\n').slice(0, 3).join(' '));
    process.exitCode = 1;
  }
  await browser.close();
  console.log('\nISSUES:\n' + ([...new Set(issues.flat())].join('\n') || 'none'));
  if (issues.flat().length) process.exitCode = 1;
})();
