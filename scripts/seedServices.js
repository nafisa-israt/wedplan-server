import "dotenv/config";
import dns from "node:dns";
import { getDb } from "../config/db.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const arg = process.argv[2];
const db = await getDb();
const services = db.collection("services");

if (arg === "clear") {
  const r = await services.deleteMany({ seeded: true });
  console.log(`Removed ${r.deletedCount} sample services`);
  process.exit(0);
}

const vendor = await db.collection("users").findOne({ email: arg?.toLowerCase(), role: "vendor" });
if (!vendor) {
  console.log("Vendor not found. Usage: node scripts/seedServices.js vendor@example.com");
  console.log("(the email must belong to an account registered as Vendor)");
  process.exit(1);
}

const img = (key) => `https://picsum.photos/seed/${key}/800/600`;
const samples = [
  ["Golden Hour Wedding Photography", "Photography & Videography", 1200, "Dhaka", "Full-day wedding photography and cinematic videography with a team of two photographers and an edited highlight film."],
  ["Royal Garden Banquet Hall", "Wedding Venues", 5000, "Chattogram", "Elegant indoor and outdoor venue for up to 500 guests with parking, bridal suite and in-house decoration support."],
  ["Blossom & Bloom Decoration", "Decoration & Florist", 900, "Dhaka", "Stage, entrance and table decoration using fresh flowers, lights and custom themes."],
  ["Spice Route Catering", "Catering Services", 15, "Comilla", "Traditional and continental wedding menus priced per guest, with service staff included."],
  ["Glow Bridal Makeup Studio", "Makeup & Styling", 350, "Sylhet", "Bridal and party makeup, hair styling and saree draping by experienced artists."],
  ["Heritage Bridal Couture", "Wedding Fashion", 800, "Dhaka", "Custom bridal lehengas, sherwanis and rental collections with free fitting sessions."],
  ["Sea View Beach Wedding Venue", "Wedding Venues", 3500, "Cox's Bazar", "Beachfront wedding packages with sunset ceremony setup, seating and sound system."],
  ["Candid Moments Studio", "Photography & Videography", 700, "Comilla", "Candid pre-wedding shoots and same-day edit photos for your event."],
];

const docs = samples.map(([serviceName, category, price, location, description], i) => ({
  vendorId: String(vendor._id),
  serviceName,
  category,
  description,
  price,
  location,
  images: [img(`wedplan${i}a`), img(`wedplan${i}b`), img(`wedplan${i}c`)],
  status: "approved",
  isActive: true,
  createdAt: new Date(Date.now() - i * 3600 * 1000),
  seeded: true,
}));

await services.insertMany(docs);
console.log(`Added ${docs.length} sample services for ${vendor.email}`);
process.exit(0);