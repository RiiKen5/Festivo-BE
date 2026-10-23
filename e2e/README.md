# End-to-end browser journeys

Drives the real web app in headless Chromium against a local API with an
in-memory MongoDB, and reports any failed API call, console error or broken
step. Razorpay order/refund calls are stubbed and Checkout is replaced by a
stand-in that signs payments with the local test secret; everything else is real.

```bash
cd backend/e2e && npm install && npx playwright install chromium
npm run stack                        # terminal 1: API on :5000 + in-memory MongoDB
cd ../../frontend && npx ng serve    # terminal 2: web app on :4200 (environment.ts -> localhost:5000)
cd backend/e2e && npm test           # terminal 3: seeds and runs every journey
```

| Journey | Covers |
|---|---|
| `journey-booking.js` | book a vendor, quote, advance + balance payment, chat, complete, review, vendor reply, payout details, admin payout + verification |
| `journey-events.js` | create private event, checklist, publish, invite link RSVP, paid ticket, check-in by code, cancel event with refunds |
| `journey-account.js` | sign up, verify email, vendor listing with photo uploads, profile + avatar, change password, forgot/reset password, search and filters |
| `journey-secondary.js` | vendor cancels a paid booking, pause/edit listing, edit/unpublish event, cancel ticket refund, notifications, legal pages |

`crawl.js` visits every page as each role; `mobile.js` checks for horizontal
overflow at phone width. Screenshots land in `shots/`.
