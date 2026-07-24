import { getTierConfig } from "../config/subscriptionTiers";

// "all" (Enterprise) ปลดล็อกทุก feature โดยไม่ต้องลิสต์ทีละตัวใน SUBSCRIPTION_TIERS
export function hasFeature(subscriptionPlan, featureKey) {
  const tier = getTierConfig(subscriptionPlan);
  return tier.features.includes(featureKey) || tier.features.includes("all");
}
