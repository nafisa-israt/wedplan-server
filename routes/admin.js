import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";
import { isValidId } from "../utils/objectId.js";
import { mapByIds } from "../utils/lookup.js";
import { isPremiumUser } from "../utils/premium.js";

const router = Router();

// এই router-এর সব route শুধু Admin-এর জন্য
router.use(verifyJWT, requireRole("admin"));

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const USER_FIELDS = {
  name: 1,
  email: 1,
  image: 1,
  role: 1,
  isBlocked: 1,
  businessName: 1,
  subscriptionPlan: 1,
  subscriptionExpiresAt: 1,
  createdAt: 1,
};

// password বা অন্য সংবেদনশীল তথ্য ছাড়া user-এর তথ্য
function publicUser(u) {
  return {
    _id: u._id,
    name: u.name,
    email: u.email,
    image: u.image || "",
    role: u.role || "customer",
    isBlocked: Boolean(u.isBlocked),
    businessName: u.businessName || "",
    subscriptionPlan: isPremiumUser(u) ? "premium" : "free",
    subscriptionExpiresAt: u.subscriptionExpiresAt || null,
    createdAt: u.createdAt,
  };
}

// GET /api/admin/stats
router.get("/stats", async (req, res, next) => {
  try {
    const db = await getDb();
    const users = db.collection("users");
    const services = db.collection("services");

    const [totalUsers, totalVendors, totalCustomers, totalServices, pendingServices, totalTransactions] =
      await Promise.all([
        users.countDocuments(),
        users.countDocuments({ role: "vendor" }),
        users.countDocuments({ role: "customer" }),
        services.countDocuments(),
        services.countDocuments({ status: "pending" }),
        db.collection("transactions").countDocuments({ status: "paid" }),
      ]);

    res.json({
      totalUsers,
      totalVendors,
      totalCustomers,
      totalServices,
      pendingServices,
      totalTransactions,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users?search=&role=
router.get("/users", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const role = String(req.query.role ?? "");

    const filter = {};
    if (["admin", "vendor", "customer"].includes(role)) filter.role = role;
    if (search) {
      const rx = { $regex: escapeRegex(search), $options: "i" };
      filter.$or = [{ name: rx }, { email: rx }];
    }

    const db = await getDb();
    const users = await db
      .collection("users")
      .find(filter, { projection: USER_FIELDS })
      .sort({ createdAt: -1 })
      .limit(200)
      .toArray();

    res.json({ users: users.map(publicUser) });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/users/:id
router.get("/users/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid user id" });

    const db = await getDb();
    const user = await db
      .collection("users")
      .findOne({ _id: new ObjectId(id) }, { projection: USER_FIELDS });
    if (!user) return res.status(404).json({ message: "User not found" });

    const details = publicUser(user);
    if (details.role === "vendor") {
      details.servicesCount = await db.collection("services").countDocuments({ vendorId: id });
      details.bookingsCount = await db.collection("bookings").countDocuments({ vendorId: id });
    } else if (details.role === "customer") {
      details.bookingsCount = await db.collection("bookings").countDocuments({ customerId: id });
    }

    res.json({ user: details });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/users/:id/block  { isBlocked: true | false }
router.patch("/users/:id/block", async (req, res, next) => {
  try {
    const { id } = req.params;
    const isBlocked = req.body?.isBlocked;

    if (!isValidId(id)) return res.status(400).json({ message: "Invalid user id" });
    if (typeof isBlocked !== "boolean") {
      return res.status(400).json({ message: "isBlocked must be true or false" });
    }
    if (id === req.user.id) {
      return res.status(400).json({ message: "You cannot block your own account" });
    }

    const db = await getDb();
    const users = db.collection("users");
    const user = await users.findOne({ _id: new ObjectId(id) });
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role === "admin") {
      return res.status(403).json({ message: "Admin accounts cannot be blocked" });
    }

    await users.updateOne({ _id: user._id }, { $set: { isBlocked } });
    res.json({
      message: isBlocked ? "User blocked successfully" : "User unblocked successfully",
      isBlocked,
    });
  } catch (err) {
    next(err);
  }
});
// GET /api/admin/services?search=&status=&category=
router.get("/services", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const status = String(req.query.status ?? "");
    const category = String(req.query.category ?? "");

    const filter = {};
    if (["pending", "approved", "rejected"].includes(status)) filter.status = status;
    if (category && category !== "all") filter.category = category;
    if (search) filter.serviceName = { $regex: escapeRegex(search), $options: "i" };

    const db = await getDb();
    const services = await db
      .collection("services")
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray();

    const vendors = await mapByIds(db, "users", services.map((s) => s.vendorId));

    res.json({
      services: services.map((s) => {
        const v = vendors.get(String(s.vendorId));
        return {
          ...s,
          vendor: v ? { name: v.businessName || v.name, email: v.email } : null,
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/services/:id/status  { status: "approved" | "rejected" | "pending" }
router.patch("/services/:id/status", async (req, res, next) => {
  try {
    const { id } = req.params;
    const status = req.body?.status;

    if (!isValidId(id)) return res.status(400).json({ message: "Invalid service id" });
    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ message: "Status must be approved, rejected or pending" });
    }

    const db = await getDb();
    const result = await db
      .collection("services")
      .updateOne({ _id: new ObjectId(id) }, { $set: { status, reviewedAt: new Date() } });

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    res.json({ message: `Service ${status} successfully`, status });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/admin/services/:id
router.delete("/services/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) return res.status(400).json({ message: "Invalid service id" });

    const db = await getDb();
    const result = await db.collection("services").deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: "Service not found" });
    }
    res.json({ message: "Service deleted successfully" });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/transactions  (শুধু দেখা যাবে, বদলানোর কোনো route নেই)
router.get("/transactions", async (req, res, next) => {
  try {
    const db = await getDb();
    const transactions = await db
      .collection("transactions")
      .find({})
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray();

    const vendors = await mapByIds(db, "users", transactions.map((t) => t.vendorId));

    const totalRevenue = transactions
      .filter((t) => t.status === "paid")
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);

    res.json({
      transactions: transactions.map((t) => {
        const v = vendors.get(String(t.vendorId));
        return {
          ...t,
          vendor: v ? { name: v.businessName || v.name, email: v.email } : null,
        };
      }),
      totalRevenue,
    });
  } catch (err) {
    next(err);
  }
});

export default router;