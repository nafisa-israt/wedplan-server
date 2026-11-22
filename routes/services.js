import { Router } from "express";
import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { isValidId } from "../utils/objectId.js";
import { isPremiumUser } from "../utils/premium.js";

const router = Router();

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// প্রতিটি service-এর সাথে vendor-এর তথ্য জুড়ে দেয়
async function attachVendors(db, services) {
  const ids = [...new Set(services.map((s) => String(s.vendorId)))].filter(isValidId);
  const vendors = ids.length
    ? await db
        .collection("users")
        .find({ _id: { $in: ids.map((id) => new ObjectId(id)) } })
        .toArray()
    : [];
  const map = new Map(vendors.map((v) => [String(v._id), v]));

  return services.map((s) => {
    const v = map.get(String(s.vendorId));
    return {
      ...s,
      vendor: v
        ? {
            id: String(v._id),
            name: v.name,
            businessName: v.businessName || "",
            image: v.image || "",
            isPremium: isPremiumUser(v),
          }
        : null,
    };
  });
}

// GET /api/services?search=&category=&location=&sort=price_asc|price_desc&page=1&limit=9
router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search ?? "").trim();
    const category = String(req.query.category ?? "").trim();
    const location = String(req.query.location ?? "").trim();
    const sort = String(req.query.sort ?? "");
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 9, 1), 50);

    // শুধু approved ও active service public-এ দেখা যাবে
    const filter = { status: "approved", isActive: true };
    if (search) filter.serviceName = { $regex: escapeRegex(search), $options: "i" };
    if (category && category !== "all") filter.category = category;
    if (location) filter.location = { $regex: escapeRegex(location), $options: "i" };

    const sortMap = { price_asc: { price: 1 }, price_desc: { price: -1 } };
    const sortBy = sortMap[sort] || { createdAt: -1 };

    const db = await getDb();
    const col = db.collection("services");

    const [total, services] = await Promise.all([
      col.countDocuments(filter),
      col
        .find(filter)
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
    ]);

    res.json({
      services: await attachVendors(db, services),
      total,
      page,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/services/:id
router.get("/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!isValidId(id)) {
      return res.status(400).json({ message: "Invalid service id" });
    }

    const db = await getDb();
    const service = await db
      .collection("services")
      .findOne({ _id: new ObjectId(id), status: "approved", isActive: true });

    if (!service) {
      return res.status(404).json({ message: "Service not found or not available" });
    }

    const [withVendor] = await attachVendors(db, [service]);
    res.json({ service: withVendor });
  } catch (err) {
    next(err);
  }
});

export default router;