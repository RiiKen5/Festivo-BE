// Loaded by Jest before any test module, so app code sees these values
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
process.env.REDIS_ENABLED = 'false';
process.env.FRONTEND_URL = 'http://localhost:4200';
process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_webhook_secret';
delete process.env.SMTP_HOST;
delete process.env.ADMIN_SECRET;
