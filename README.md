# WedPlan — Wedding Planning Platform (Server)

Express.js REST API for WedPlan: authentication verification, role-based access control, services, bookings, admin management and Stripe subscription payments.

## Live Links

- **Live Website:** https://wedplan-client-omega-beryl.vercel.app/
- **Client Repository:** https://github.com/nafisa-israt/wedplan-client
- **Server Repository:** https://github.com/nafisa-israt/wedplan-server
- **API Base URL:** https://wedplan-server-kr5y.onrender.com

## Important Features

- JWT verification middleware (rejects invalid or expired tokens with 401)
- Role-based middleware for Admin, Vendor and Customer (403 on forbidden access)
- Ownership checks before updating or deleting resources
- Services CRUD with approval workflow (pending, approved, rejected)
- Free plan limit: maximum 3 active services; Premium is unlimited
- Booking system with duplicate-request prevention and status rules
- Admin APIs for users, services and transactions
- Stripe Checkout session creation for vendors
- Stripe webhook verification: Premium is activated only after verified webhook events
- Subscription renewal, cancellation and expiration handling
- Centralized error handling and 404 handler

## Technology Stack

- Node.js, Express.js
- MongoDB (native driver)
- Stripe
- JWT verification
- CORS, dotenv

## API Overview

| Route | Description |
|---|---|
| `GET /api/health` | Health and database check |
| `/api/me` | Current user profile |
| `/api/services` | Public service listing and details |
| `/api/vendor` | Vendor service and booking management |
| `/api/bookings` | Customer booking requests |
| `/api/admin` | Admin user, service and transaction management |
| `POST /api/stripe/checkout` | Create Stripe Checkout session (vendor only) |
| `GET /api/stripe/status` | Current subscription status (vendor only) |
| `POST /api/stripe/webhook` | Stripe webhook endpoint |

## Installation

```bash
git clone https://github.com/nafisa-israt/wedplan-server.git
cd wedplan-server
npm install
```

## Environment Variables

Create a `.env` file in the project root (never commit it):

```env
PORT=5000
CLIENT_URL=http://localhost:3000

# MongoDB
MONGODB_URI=your_mongodb_connection_string       
DB_NAME=your_database_name                   

# Stripe
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
STRIPE_PRICE_ID=price_xxxxxxxxxxxx                

# Auth / JWT verification
process.env.CLIENT_URL 
```

## Run Locally

```bash
npm run dev     # or: npm start
```

The API runs on http://localhost:5000.

## Test Stripe Webhooks Locally

```bash
stripe listen --forward-to localhost:5000/api/stripe/webhook
```

Copy the printed `whsec_...` value into `STRIPE_WEBHOOK_SECRET`.

Test card: `4242 4242 4242 4242`, any future expiry, any CVC.

## Production Webhook Setup

1. Stripe Dashboard (test mode) → Developers → Webhooks → Add endpoint
2. URL: `https://wedplan-server-kr5y.onrender.com/api/stripe/webhook`
3. Events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Add the signing secret as `STRIPE_WEBHOOK_SECRET`

## Deployment

Deployed on Render. Set all environment variables in the Render dashboard.

## Author

Nafisa Israt