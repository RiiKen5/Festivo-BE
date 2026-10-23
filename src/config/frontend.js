// FRONTEND_URL may list several sites, comma separated, e.g.
//   FRONTEND_URL=https://festivo.paathly.in,https://festivo-frontend.onrender.com
// All of them may call the API (CORS); the first is the main site used in
// email and invite links.

const DEFAULT = 'http://localhost:4200';

// Production sites that may always call the API, whatever FRONTEND_URL says
const KNOWN_SITES = ['https://festivo.paathly.in', 'https://festivo-frontend.onrender.com'];

const list = () => (process.env.FRONTEND_URL || DEFAULT)
  .split(',')
  .map(url => url.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const allowed = () => [...new Set([...list(), ...KNOWN_SITES])];

exports.allowedOrigins = allowed;

exports.frontendUrl = () => list()[0] || DEFAULT;

// For the cors / socket.io `origin` option
exports.corsOrigin = (origin, callback) => {
  // Requests without an Origin header (curl, server-to-server, same-origin) are allowed
  if (!origin || allowed().includes(origin.replace(/\/+$/, ''))) {
    return callback(null, true);
  }
  callback(null, false);
};
