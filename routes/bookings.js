import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { isValidId } from "../utils/objectId.js";
import { mapByIds } from "../utils/lookup.js";

const router = Router();


router.use(verifyJWT, requireRole("customer", "vendor"));

// POST /api/bookings 
router.post("/", async (req, res, next) => {
  try {
    const { serviceId, eventDate, eventLocation, message } = req.body || {};

    if (!isValidId(serviceId)) {
      return res.status(400).json({ message: "Invalid service" });
    }

    const date = String(eventDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
      return res.status(400).json({ message: "Please choose a valid event date" });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (date < today) {
      return res.status(400).json({ message: "Event date cannot be in the past" });
    }

    const location = String(eventLocation ?? "").trim();
    if (!location) {
      return res.status(400).json({ message: "Event location is required" });
    }

    const note = String(message ?? "").trim();
    if (note.length > 1000) {
      return res.status(400).json({ message: "Message must be 1000 characters or less" });
    }

    const db = await getDb();

    
    const service = await db
      .collection("services")
      .findOne({ _id: new ObjectId(serviceId), status: "approved", isActive: true });
    if (!service) {
      return res.status(404).json({ message: "Service not found or not available" });
    }

    
    if (service.vendorId === req.user.id) {
      return res.status(403).json({ message: "You cannot book your own service" });
    }

  
    const duplicate = await db.collection("bookings").findOne({
      serviceId,
      customerId: req.user.id,
      eventDate: date,
      status: { $in: ["pending", "accepted"] },
    });
    if (duplicate) {
      return res.status(409).json({
        message: "You already have an active booking request for this service on this date",
      });
    }

    const doc = {
      serviceId,
      vendorId: service.vendorId,
      customerId: req.user.id,
      eventDate: date,
      eventLocation: location,
      message: note,
      status: "pending",
      createdAt: new Date(),
    };
    const result = await db.collection("bookings").insertOne(doc);
    res.status(201).json({ booking: { ...doc, _id: result.insertedId } });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/stats
router.get("/stats", async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db
      .collection("bookings")
      .aggregate([
        { $match: { customerId: req.user.id } },
        { $group: { _id: "$status", count: { $sum: 1 } } },
      ])
      .toArray();

    const by = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    res.json({
      total: rows.reduce((sum, r) => sum + r.count, 0),
      pending: by.pending || 0,
      accepted: by.accepted || 0,
      rejected: by.rejected || 0,
      cancelled: by.cancelled || 0,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/bookings/my
router.get("/my", async (req, res, next) => {
  try {
    const db = await getDb();
    const bookings = await db
      .collection("bookings")
      .find({ customerId: req.user.id })
      .sort({ createdAt: -1 })
      .toArray();

    const services = await mapByIds(db, "services", bookings.map((b) => b.serviceId));
    const vendors = await mapByIds(db, "users", bookings.map((b) => b.vendorId));

    res.json({
      bookings: bookings.map((b) => {
        const s = services.get(String(b.serviceId));
        const v = vendors.get(String(b.vendorId));
        return {
          ...b,
          service: s
            ? { name: s.serviceName, image: s.images?.[0] || "", category: s.category, price: s.price }
            : null,
          vendor: v ? { name: v.businessName || v.name, image: v.image || "" } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});


router.patch("/:id/cancel", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid booking id" });
    }

    const db = await getDb();
    const bookings = db.collection("bookings");
    const booking = await bookings.findOne({ _id: new ObjectId(id) });

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }
    
    if (booking.customerId !== req.user.id) {
      return res.status(403).json({ message: "You can only cancel your own bookings" });
    }
    if (booking.status !== "pending") {
      return res.status(400).json({
        message: `This booking is already ${booking.status} and cannot be cancelled`,
      });
    }

    
    const result = await bookings.updateOne(
      { _id: booking._id, customerId: req.user.id, status: "pending" },
      { $set: { status: "cancelled", cancelledAt: new Date() } }
    );
    if (result.matchedCount === 0) {
      return res.status(409).json({ message: "This booking has just been updated by the vendor" });
    }

    res.json({ message: "Booking cancelled successfully" });
  } catch (err) {
    next(err);
  }
});

export default router;