import { Router } from "express";
import express from "express";
import Stripe from "stripe";
import { ObjectId } from "mongodb";
import { getDb } from "../config/db.js";
import { verifyJWT } from "../middleware/auth.js";
import { requireRole } from "../middleware/roles.js";

const router = Router();

const PREMIUM_PRICE_CENTS = 999; // $9.99 / month

const stripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not configured");
  }
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};


const getPeriodEnd = (subscription) => {
  const ts =
    subscription.items?.data?.[0]?.current_period_end ??
    subscription.current_period_end;
  return ts ? new Date(ts * 1000) : null;
};

const idOf = (value) => (typeof value === "string" ? value : value?.id);


router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const signature = req.headers["stripe-signature"];

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).send("Webhook secret is not configured");
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    const db = await getDb();
    const users = db.collection("users");
    const transactions = db.collection("transactions");

    
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const vendorId = session.metadata?.vendorId;
      const subscriptionId = idOf(session.subscription);

      if (
        session.mode === "subscription" &&
        session.payment_status === "paid" &&
        vendorId &&
        ObjectId.isValid(vendorId) &&
        subscriptionId
      ) {
        const subscription = await stripe().subscriptions.retrieve(subscriptionId);

        await users.updateOne(
          { _id: new ObjectId(vendorId) },
          {
            $set: {
              subscriptionPlan: "premium",
              subscriptionExpiresAt: getPeriodEnd(subscription),
              stripeCustomerId: String(idOf(session.customer)),
              stripeSubscriptionId: String(subscriptionId),
              cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
            },
          }
        );

        const invoiceId = idOf(session.invoice);
        const filter = invoiceId
          ? { stripeInvoiceId: String(invoiceId) }
          : { stripeSessionId: session.id };
        const setFields = { stripeSubscriptionId: String(subscriptionId) };
        if (invoiceId) setFields.stripeSessionId = session.id;

        await transactions.updateOne(
          filter,
          {
            $set: setFields,
            $setOnInsert: {
              vendorId,
              plan: "premium",
              amount: Number(session.amount_total || 0) / 100,
              currency: session.currency || "usd",
              status: "paid",
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      }
    }

    
    if (event.type === "invoice.paid") {
      const invoice = event.data.object;
      const subscriptionId = idOf(
        invoice.subscription || invoice.parent?.subscription_details?.subscription
      );

      if (subscriptionId) {
        const subscription = await stripe().subscriptions.retrieve(subscriptionId);
        const vendorId = subscription.metadata?.vendorId;

        if (vendorId && ObjectId.isValid(vendorId)) {
          await users.updateOne(
            { _id: new ObjectId(vendorId) },
            {
              $set: {
                subscriptionPlan: "premium",
                subscriptionExpiresAt: getPeriodEnd(subscription),
                stripeSubscriptionId: String(subscriptionId),
              },
            }
          );

          await transactions.updateOne(
            { stripeInvoiceId: invoice.id },
            {
              $set: { stripeSubscriptionId: String(subscriptionId) },
              $setOnInsert: {
                vendorId,
                plan: "premium",
                amount: Number(invoice.amount_paid || 0) / 100,
                currency: invoice.currency || "usd",
                status: "paid",
                createdAt: new Date((invoice.created || Date.now() / 1000) * 1000),
              },
            },
            { upsert: true }
          );
        }
      }
    }

    
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      const subscription = event.data.object;
      const vendorId = subscription.metadata?.vendorId;

      if (vendorId && ObjectId.isValid(vendorId)) {
        const status = subscription.status;

        if (status === "active" || status === "trialing") {
          await users.updateOne(
            { _id: new ObjectId(vendorId) },
            {
              $set: {
                subscriptionPlan: "premium",
                subscriptionExpiresAt: getPeriodEnd(subscription),
                cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
              },
            }
          );
        } else if (["canceled", "unpaid", "incomplete_expired"].includes(status)) {
          await users.updateOne(
            { _id: new ObjectId(vendorId) },
            {
              $set: {
                subscriptionPlan: "free",
                subscriptionExpiresAt: getPeriodEnd(subscription),
                cancelAtPeriodEnd: false,
              },
            }
          );
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Stripe webhook processing error:", err);
    return res.status(500).json({ message: "Webhook processing failed" });
  }
});


router.post("/checkout", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const db = await getDb();
    const user = await db.collection("users").findOne({ _id: new ObjectId(req.user.id) });

    if (!user) {
      return res.status(404).json({ message: "Vendor not found" });
    }

    if (
      user.subscriptionPlan === "premium" &&
      (!user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt) > new Date())
    ) {
      return res.status(400).json({ message: "You already have an active Premium subscription" });
    }

    const clientUrl = process.env.CLIENT_URL?.replace(/\/$/, "");
    if (!clientUrl) {
      return res.status(500).json({ message: "CLIENT_URL is not configured" });
    }

    
    const lineItem = process.env.STRIPE_PRICE_ID
      ? { price: process.env.STRIPE_PRICE_ID, quantity: 1 }
      : {
          price_data: {
            currency: "usd",
            unit_amount: PREMIUM_PRICE_CENTS,
            recurring: { interval: "month" },
            product_data: { name: "WedPlan Premium Vendor" },
          },
          quantity: 1,
        };

    const sessionData = {
      mode: "subscription",
      line_items: [lineItem],
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancel`,
      client_reference_id: req.user.id,
      metadata: { vendorId: req.user.id },
      subscription_data: { metadata: { vendorId: req.user.id } },
    };

    if (user.stripeCustomerId) {
      sessionData.customer = user.stripeCustomerId;
    } else {
      sessionData.customer_email = user.email;
    }

    const session = await stripe().checkout.sessions.create(sessionData);
    return res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err.message);
    return res.status(502).json({ message: "Could not start the payment. Please try again." });
  }
});


router.get("/status", verifyJWT, requireRole("vendor"), async (req, res, next) => {
  try {
    const db = await getDb();
    const user = await db.collection("users").findOne(
      { _id: new ObjectId(req.user.id) },
      { projection: { subscriptionPlan: 1, subscriptionExpiresAt: 1, cancelAtPeriodEnd: 1 } }
    );

    const active =
      user?.subscriptionPlan === "premium" &&
      (!user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt) > new Date());

    return res.json({
      plan: active ? "premium" : "free",
      expiresAt: user?.subscriptionExpiresAt || null,
      cancelAtPeriodEnd: Boolean(user?.cancelAtPeriodEnd),
    });
  } catch (err) {
    next(err);
  }
});

export default router;