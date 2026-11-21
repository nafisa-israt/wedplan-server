import { MongoClient } from "mongodb";

let clientPromise;

function getClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set in environment variables");
  }
  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }
  return clientPromise;
}

export async function getDb() {
  const client = await getClient();
  return client.db(process.env.DB_NAME || "wedplan");
}