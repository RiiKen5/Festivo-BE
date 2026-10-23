const path = require('path');
const BE = path.resolve(__dirname, '..');
const { MongoMemoryServer } = require(BE + '/node_modules/mongodb-memory-server');
const { spawn } = require('child_process');

(async () => {
  const mongo = await MongoMemoryServer.create({ instance: { port: 27099, dbName: 'festivo' } });
  const uri = mongo.getUri('festivo');
  const env = {
    ...process.env, MONGODB_URI: uri, PORT: '5000', NODE_ENV: 'development', REDIS_ENABLED: 'false',
    FRONTEND_URL: 'http://localhost:4200', JWT_SECRET: 'devjwt', JWT_REFRESH_SECRET: 'devrefresh',
    ADMIN_SECRET: 'e2e-admin', RAZORPAY_KEY_ID: 'rzp_test_e2e', RAZORPAY_KEY_SECRET: 'e2e_secret',
    RAZORPAY_WEBHOOK_SECRET: 'e2e_webhook', SMTP_HOST: '', GOOGLE_CLIENT_ID: ''
  };
  const srv = spawn('node', ['-r', path.join(__dirname, 'razorpay-mock.js'), 'server.js'], { env, cwd: BE, stdio: 'inherit' });
  console.log('[e2e] mongo at', uri);
  const stop = async () => { srv.kill('SIGTERM'); await mongo.stop(); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})();
