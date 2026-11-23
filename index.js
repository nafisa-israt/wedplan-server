
import "dotenv/config";
import express from "express";
import dns from "node:dns";
import cors from "cors";

import servicesRoutes from "./routes/services.js";
import adminRoutes from "./routes/admin.js";
import bookingRoutes from "./routes/bookings.js";
import vendorRoutes from "./routes/vendor.js";
import meRoutes from "./routes/me.js";
import stripeRoutes from "./routes/stripe.js";

import { getDb } from "./config/db.js";

if (!process.env.VERCEL) {
  dns.setServers(["8.8.8.8", "8.8.4.4"]);
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

// Stripe webhook must be before express.json()
app.use("/api/stripe", stripeRoutes);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "WedPlan API is running" });
});

app.use("/api/me", meRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", async (req, res, next) => {
  try {
    const db = await getDb();
    await db.command({ ping: 1 });
    res.json({ status: "ok", database: "connected" });
  } catch (err) {
    next(err);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: "Route not found" });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    message: err.message || "Internal server error",
  });
});

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

export default app;
