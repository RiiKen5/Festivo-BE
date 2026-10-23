// Preloaded into the backend for local e2e: stubs only the calls that would
// reach Razorpay's servers. Signature checks stay real.
const paymentService = require('../src/services/paymentService');
let n = 0;
paymentService.createOrder = async (amount) => ({ id: `order_e2e${Date.now()}${++n}`, amount: Math.round(amount * 100) });
paymentService.refund = async (paymentId, amount) => ({ id: `rfnd_e2e${++n}`, amount });
console.log('[e2e] Razorpay orders/refunds stubbed');
