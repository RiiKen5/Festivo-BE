# Festivo Backend API

A complete Node.js + Express + MongoDB backend for the Festivo Event Platform - an event marketplace connecting organizers with service providers.

## Features

- **Authentication**: JWT-based with access & refresh tokens
- **Events**: Create, manage, and discover events
- **Services**: Marketplace for vendors (catering, DJ, photography, etc.)
- **Bookings**: Book services with payment integration
- **Real-time**: Socket.io for messaging and notifications
- **Geospatial**: Find nearby events and services
- **Reviews**: Rating system with vendor responses

## Tech Stack

- Node.js + Express
- MongoDB + Mongoose
- Redis (optional caching)
- Socket.io
- JWT Authentication
- Razorpay Payments
- AWS S3 (file uploads)

## Quick Start

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI

# Run development server
npm run dev

# Server runs on http://localhost:5000
```

## API Endpoints

| Module | Base Route | Description |
|--------|------------|-------------|
| Auth | `/api/v1/auth` | Register, Login, Refresh Token |
| Users | `/api/v1/users` | User profiles |
| Events | `/api/v1/events` | Event CRUD |
| Services | `/api/v1/services` | Service marketplace |
| Bookings | `/api/v1/bookings` | Booking management |
| Tasks | `/api/v1/tasks` | Event task tracking |
| RSVPs | `/api/v1/rsvps` | Event RSVPs |
| Messages | `/api/v1/messages` | Real-time messaging |
| Reviews | `/api/v1/reviews` | Service reviews |
| Notifications | `/api/v1/notifications` | User notifications |

## Health Check

```bash
curl http://localhost:5000/api/v1/health
```

## Environment Variables

See `.env.example` for all required environment variables.

## Postman Collection

Import `Festivo_API_Postman_Collection.json` into Postman to test all endpoints.

## License

MIT
