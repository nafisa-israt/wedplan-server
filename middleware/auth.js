import { createRemoteJWKSet, jwtVerify } from "jose";
import { getDb } from "../config/db.js";

function getBaseUrl() {
  return (process.env.CLIENT_URL || "").replace(/\/$/, "");
}

let jwks;
function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${getBaseUrl()}/api/auth/jwks`));
  }
  return jwks;
}


export async function verifyJWT(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized: access token is missing" });
  }
  const token = header.slice(7).trim();

  let payload;
  try {
    const result = await jwtVerify(token, getJwks(), { issuer: getBaseUrl() });
    payload = result.payload;
  } catch (err) {
    console.error("JWT verification failed:", err.code || err.message);
    return res.status(401).json({ message: "Unauthorized: invalid or expired token" });
  }

  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ email: payload.email });

    if (!user) {
      return res.status(401).json({ message: "Unauthorized: user not found" });
    }
    if (user.isBlocked) {
      return res.status(403).json({ message: "Your account has been blocked" });
    }

    
    req.user = {
      id: String(user._id),
      name: user.name,
      email: user.email,
      image: user.image || "",
      role: user.role || "customer",
      businessName: user.businessName || "",
      subscriptionPlan: user.subscriptionPlan || "free",
      subscriptionExpiresAt: user.subscriptionExpiresAt || null,
    };
    next();
  } catch (err) {
    next(err);
  }
}