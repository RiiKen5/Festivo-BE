// A user deletes their account from Profile > Security; a host with an
// upcoming event is told what to do first. The public deletion page loads.
const { chromium, APP, session, login, settle, api } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

(async () => {
  const browser = await chromium.launch();

  // A host with upcoming events can't delete yet, and is told why
  const host = await session(browser, 'host');
  await login(host.page, 'rohit@test.in');
  await host.page.goto(`${APP}/profile`); await settle(host.page);
  await host.page.getByRole('button', { name: /Security/ }).first().click(); await settle(host.page);
  check(await until(() => host.page.getByText(/upcoming event/).isVisible()), 'host is told to cancel upcoming events first');
  check(!(await host.page.getByRole('button', { name: 'Delete my account' }).count()), 'no delete button while something is open');

  // An attendee with nothing open deletes their account
  const guest = await session(browser, 'asha');
  await login(guest.page, 'asha@test.in');
  await guest.page.goto(`${APP}/profile`); await settle(guest.page);
  await guest.page.getByRole('button', { name: /Security/ }).first().click(); await settle(guest.page);
  const button = guest.page.getByRole('button', { name: 'Delete my account' });
  check(await until(() => button.isVisible()), 'delete option shown');
  check(await button.isDisabled(), 'needs DELETE typed first');
  await guest.page.locator('#delete-confirm').fill('DELETE');
  guest.page.once('dialog', d => d.accept());
  await button.click();
  check(await until(() => guest.page.waitForURL(u => u.pathname === '/', { timeout: 1000 }).then(() => true)), 'signed out and sent home');
  const relogin = await api('/auth/login', { method: 'POST', body: { email: 'asha@test.in', password: 'Password123!' } });
  check(relogin.success === false, 'deleted account can no longer log in');

  // The public page Google Play links to
  await guest.page.goto(`${APP}/delete-account`); await settle(guest.page);
  check(await guest.page.getByRole('heading', { name: 'Delete your Festivo account' }).isVisible(), 'public deletion page loads');

  await browser.close();
  const issues = [...host.issues, ...guest.issues].filter(x => !/-> 401/.test(x));
  issues.forEach(x => console.log('ISSUE', x));
  if (issues.length) process.exitCode = 1;
})();
