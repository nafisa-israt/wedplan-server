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

// এই router-এর সব route শুধু logged-in Vendor-এর জন্য
router.use(verifyJWT, requireRole("vendor"));

// "active" = চালু আছে এবং reject হয়নি (pending + approved)
async function countActive(db, vendorId, excludeId) {
  const filter = { vendorId, isActive: true, status: { $in: ["pending", "approved"] } };
  if (excludeId) filter._id = { $ne: excludeId };
  return db.collection("services").countDocuments(filter);
}

// নিজের service কি না যাচাই করে (ownership check)
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

    // Free plan: সর্বোচ্চ ৩টা active service
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

export default router;