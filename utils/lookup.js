import { ObjectId } from "mongodb";
import { isValidId } from "./objectId.js";

// কিছু id দিলে সেই document-গুলো Map আকারে ফেরত দেয় (key = id string)
export async function mapByIds(db, collection, ids) {
  const objectIds = [...new Set(ids.map(String))]
    .filter(isValidId)
    .map((id) => new ObjectId(id));

  if (objectIds.length === 0) return new Map();

  const docs = await db
    .collection(collection)
    .find({ _id: { $in: objectIds } })
    .toArray();

  return new Map(docs.map((d) => [String(d._id), d]));
}