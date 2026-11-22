import "dotenv/config";
import dns from "node:dns";
import { getDb } from "../config/db.js";

dns.setServers(["8.8.8.8", "8.8.4.4"]);

const email = process.argv[2]?.toLowerCase();
if (!email) {
  console.log("Usage: node scripts/makeAdmin.js user@example.com");
  process.exit(1);
}

const db = await getDb();
const result = await db.collection("users").updateOne({ email }, { $set: { role: "admin" } });

if (result.matchedCount === 0) {
  console.log(`No user found with email ${email}. Please sign up first.`);
} else {
  console.log(`Done! ${email} is now an admin.`);
}
process.exit(0);