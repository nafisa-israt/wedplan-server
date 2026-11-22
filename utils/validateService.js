import { CATEGORIES } from "./constants.js";


export function validateService(body = {}) {
  const serviceName = String(body.serviceName ?? "").trim();
  const category = String(body.category ?? "").trim();
  const description = String(body.description ?? "").trim();
  const location = String(body.location ?? "").trim();
  const price = Number(body.price);
  const images = Array.isArray(body.images)
    ? body.images.filter((u) => typeof u === "string" && /^https?:\/\//.test(u))
    : [];

  if (serviceName.length < 3) return { error: "Service name must be at least 3 characters" };
  if (!CATEGORIES.includes(category)) return { error: "Please select a valid category" };
  if (description.length < 20) return { error: "Description must be at least 20 characters" };
  if (!location) return { error: "Location is required" };
  if (!Number.isFinite(price) || price <= 0) return { error: "Price must be a number greater than 0" };
  if (images.length === 0) return { error: "At least one service image is required" };
  if (images.length > 5) return { error: "You can add at most 5 images" };

  return { data: { serviceName, category, description, location, price, images } };
}