// Voice messages: record with a (fake) microphone, send, the other person plays it.
const { chromium, APP, session, login, settle, api, tokenFor } = require('./lib');

const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) process.exitCode = 1; };
const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn().catch(() => false)) return true; await new Promise(r => setTimeout(r, 200)); } return false; };

(async () => {
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const priyaId = (await api('/auth/me', { token: await tokenFor('priya@test.in') })).data._id;
  const rohitId = (await api('/auth/me', { token: await tokenFor('rohit@test.in') })).data._id;

  const org = await session(browser, 'rohit');
  await org.context.grantPermissions(['microphone']);
  const ven = await session(browser, 'priya');
  await login(org.page, 'rohit@test.in');
  await login(ven.page, 'priya@test.in');
  await ven.page.goto(APP + '/messages/' + rohitId); await settle(ven.page);
  await org.page.goto(APP + '/messages/' + priyaId); await settle(org.page);

  await org.page.getByRole('button', { name: 'Record a voice message' }).click();
  check(await until(() => org.page.getByRole('group', { name: 'Recording voice message' }).isVisible()), 'recording bar with timer appears');
  await org.page.waitForTimeout(2300);
  check(await org.page.locator('.rec__time').innerText().then(t => t >= '0:02'), 'timer counts up');
  await org.page.getByRole('button', { name: 'Send voice message' }).click();
  check(await until(() => org.page.locator('.bubble--mine app-voice-note').isVisible()), 'voice message appears for the sender');

  check(await until(() => ven.page.locator('.bubble app-voice-note').isVisible()), 'voice message arrives live for the receiver');
  await ven.page.getByRole('button', { name: 'Play voice message' }).click();
  check(await until(() => ven.page.getByRole('button', { name: 'Pause voice message' }).isVisible(), 5000), 'receiver can play it');
  await ven.page.screenshot({ path: 'shots/chat-voice.png' });

  // Cancel throws the recording away
  const before = await org.page.locator('app-voice-note').count();
  await org.page.getByRole('button', { name: 'Record a voice message' }).click();
  await org.page.waitForTimeout(1200);
  await org.page.getByRole('button', { name: 'Cancel recording' }).click();
  await org.page.waitForTimeout(800);
  check(await org.page.locator('app-voice-note').count() === before, 'cancel does not send');

  await browser.close();
  const problems = [...org.issues, ...ven.issues];
  problems.forEach(x => console.log('ISSUE', x));
  if (problems.length) process.exitCode = 1;
})();
