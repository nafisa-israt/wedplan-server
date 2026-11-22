// Premium আছে কি না: plan premium এবং মেয়াদ শেষ হয়নি
export function isPremiumUser(user) {
  if (!user || user.subscriptionPlan !== "premium") return false;
  if (!user.subscriptionExpiresAt) return true;
  return new Date(user.subscriptionExpiresAt) > new Date();
}