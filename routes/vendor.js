import { mapByIds } from "../utils/lookup.js";
import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { isValidId } from "../utils/objectId.js";
import { isPremiumUser } from "../utils/premium.js";
import { FREE_SERVICE_LIMIT } from "../utils/constants.js";
import { validateService } from "../utils/validateService.js";

const router = Router();


router.use(verifyJWT, requireRole("vendor"));


async function countActive(db, vendorId, excludeId) {
  const filter = { vendorId, isActive: true, status: { $in: ["pending", "approved"] } };
  if (excludeId) filter._id = { $ne: excludeId };
  return db.collection("services").countDocuments(filter);
}


async function getOwnedService(db, req, res) {
  const { id } = req.params;
  if (!isValidId(id)) {
    res.status(400).json({ message: "Invalid service id" });
    return null;
  }
  const service = await db.collection("services").findOne({ _id: new ObjectId(id) });
  if (!service) {
    res.status(404).json({ message: "Service not found" });
    return null;
  }
  if (service.vendorId !== req.user.id) {
    res.status(403).json({ message: "You can only manage your own services" });
    return null;
  }
  return service;
}

// GET /api/vendor/stats
router.get("/stats", async (req, res, next) => {
  try {
    const db = await getDb();
    const vendorId = req.user.id;

    const [totalServices, activeServices, pendingBookings, acceptedBookings] = await Promise.all([
      db.collection("services").countDocuments({ vendorId }),
      countActive(db, vendorId),
      db.collection("bookings").countDocuments({ vendorId, status: "pending" }),
      db.collection("bookings").countDocuments({ vendorId, status: "accepted" }),
    ]);

    res.json({
      totalServices,
      activeServices,
      pendingBookings,
      acceptedBookings,
      plan: isPremiumUser(req.user) ? "premium" : "free",
      subscriptionExpiresAt: req.user.subscriptionExpiresAt,
      freeLimit: FREE_SERVICE_LIMIT,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/vendor/services
router.get("/services", async (req, res, next) => {
  try {
    const db = await getDb();
    const services = await db
      .collection("services")
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ services });
  } catch (err) {
    next(err);
  }
});

// GET /api/vendor/services/:id
router.get("/services/:id", async (req, res, next) => {
  try {
    const db = await getDb();
    const service = await getOwnedService(db, req, res);
    if (!service) return;
    res.json({ service });
  } catch (err) {
    next(err);
  }
});

// POST /api/vendor/services
router.post("/services", async (req, res, next) => {
  try {
    const { error, data } = validateService(req.body);
    if (error) return res.status(400).json({ message: error });

    const db = await getDb();

   
    if (!isPremiumUser(req.user)) {
      const active = await countActive(db, req.user.id);
      if (active >= FREE_SERVICE_LIMIT) {
        return res.status(403).json({
          message: `Free plan allows only ${FREE_SERVICE_LIMIT} active services. Upgrade to Premium to publish more.`,
          code: "PLAN_LIMIT",
        });
      }
    }

    const doc = {
      ...data,
      vendorId: req.user.id,
      status: "pending",
      isActive: true,
      createdAt: new Date(),
    };
    const result = await db.collection("services").insertOne(doc);
    res.status(201).json({ service: { ...doc, _id: result.insertedId } });
  } catch (err) {
    next(err);
  }
});

// PUT /api/vendor/services/:id 
router.put("/services/:id", async (req, res, next) => {
  try {
    const { error, data } = validateService(req.body);
    if (error) return res.status(400).json({ message: error });

    const db = await getDb();
    const service = await getOwnedService(db, req, res);
    if (!service) return;

    await db
      .collection("services")
      .updateOne({ _id: service._id }, { $set: { ...data, updatedAt: new Date() } });

    res.json({ message: "Service updated successfully" });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/vendor/services/:id/availability 
router.patch("/services/:id/availability", async (req, res, next) => {
  try {
    const isActive = req.body?.isActive;
    if (typeof isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be true or false" });
    }

    const db = await getDb();
    const service = await getOwnedService(db, req, res);
    if (!service) return;

   
    if (isActive && !service.isActive && service.status !== "rejected" && !isPremiumUser(req.user)) {
      const active = await countActive(db, req.user.id, service._id);
      if (active >= FREE_SERVICE_LIMIT) {
        return res.status(403).json({
          message: `Free plan allows only ${FREE_SERVICE_LIMIT} active services. Upgrade to Premium to publish more.`,
          code: "PLAN_LIMIT",
        });
      }
    }

    await db.collection("services").updateOne({ _id: service._id }, { $set: { isActive } });
    res.json({ message: isActive ? "Service is now available" : "Service is now unavailable", isActive });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/vendor/services/:id
router.delete("/services/:id", async (req, res, next) => {
  try {
    const db = await getDb();
    const service = await getOwnedService(db, req, res);
    if (!service) return;

    await db.collection("services").deleteOne({ _id: service._id });
    res.json({ message: "Service deleted successfully" });
  } catch (err) {
    next(err);
  }
});
// GET /api/vendor/bookings
router.get("/bookings", async (req, res, next) => {
  try {
    const db = await getDb();
    const bookings = await db
      .collection("bookings")
      .find({ vendorId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const services = await mapByIds(db, "services", bookings.map((b) => b.serviceId));
    const customers = await mapByIds(db, "users", bookings.map((b) => b.customerId));

    res.json({
      bookings: bookings.map((b) => {
        const s = services.get(String(b.serviceId));
        const c = customers.get(String(b.customerId));
        return {
          ...b,
          service: s ? { name: s.serviceName, image: s.images?.[0] || "", price: s.price } : null,
          customer: c ? { name: c.name, email: c.email, image: c.image || "" } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/vendor/bookings/:id/status  { status: "accepted" | "rejected" }
router.patch("/bookings/:id/status", async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = req.body?.status;

    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid booking id" });
    }
    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Status must be accepted or rejected" });
    }

    const db = await getDb();
    const bookings = db.collection("bookings");
    const booking = await bookings.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
   
    if (booking.vendorId !== req.user.id) {
      return res.status(403).json({ message: "You can only manage booking requests for your own services" });
    }
    // শুধু pending request process করা যাবে, একবার হয়ে গেলে আর না
    if (booking.status !== "pending") {
      return res.status(400).json({
        message: `This request is already ${booking.status} and cannot be processed again`,
      });
    }

    const result = await bookings.updateOne(
      { _id: booking._id, vendorId: req.user.id, status: "pending" },
      { $set: { status, respondedAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(409).json({ message: "This request has just been updated" });
    }

    res.json({ message: `Booking ${status} successfully`, status });
  } catch (err) {
    next(err);
  }
});

export default router;