const BE = require('path').resolve(__dirname, '..');
const mongoose = require(BE + '/node_modules/mongoose');
const User = require(BE + '/src/models/User');
const Event = require(BE + '/src/models/Event');
const Service = require(BE + '/src/models/Service');
const DAY = 864e5;

(async () => {
  await mongoose.connect('mongodb://127.0.0.1:27099/festivo');
  await mongoose.connection.db.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map(m => m.syncIndexes()));
  const mk = (email, name, extra = {}) => User.create({ email, name, password: 'Password123!', city: 'Pune', emailVerified: true, ...extra });
  const org = await mk('rohit@test.in', 'Rohit Organizer', { userType: 'organizer', phone: '9876500001' });
  const priya = await mk('priya@test.in', 'Priya Cakes', { userType: 'helper', phone: '9876500002' });
  const flash = await mk('flash@test.in', 'Flash Photography', { userType: 'helper' });
  const att = await mk('asha@test.in', 'Asha Attendee', { userType: 'attendee' });
  await mk('admin@test.in', 'Admin', { role: 'admin' });

  await Service.create({ serviceName: "Priya's Designer Cakes", provider: priya._id, category: 'food', description: 'Custom theme cakes for birthdays and weddings. Eggless options available.', basePrice: 1800, priceUnit: 'per_event', city: 'Pune', tags: ['cake', 'birthday'] });
  await Service.create({ serviceName: 'Flash Photography', provider: flash._id, category: 'photography', description: 'Candid event photography, 300+ edited photos delivered in 5 days.', basePrice: 5000, priceUnit: 'per_event', city: 'Pune', isVerified: true });

  const base = { organizer: org._id, time: '19:00', locationName: 'Koregaon Park Club', address: 'Lane 5, Koregaon Park', city: 'Pune', expectedGuests: 40 };
  await Event.create({ ...base, title: "Rohit's 30th Birthday", description: 'Private birthday dinner with close friends.', eventType: 'birthday', date: new Date(Date.now() + 20 * DAY), isPublic: false, status: 'planning', budget: 15000 });
  await Event.create({ ...base, title: 'Pune Startup Mixer', description: 'Meet founders and builders over drinks.', eventType: 'meetup', date: new Date(Date.now() + 10 * DAY), isPublic: true, isPublished: true, status: 'active', maxAttendees: 60 });
  await Event.create({ ...base, title: 'Sunset Rooftop Party', description: 'Music, food and a great view. Ticket includes 2 drinks.', eventType: 'house_party', date: new Date(Date.now() + 12 * DAY), isPublic: true, isPublished: true, status: 'active', entryFee: 499, isPaid: true, maxAttendees: 80 });
  console.log('seeded');
  await mongoose.disconnect();
})();
