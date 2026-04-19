/**
 * Purchase module — stub for RevenueCat integration.
 *
 * To enable real IAP:
 *   1. `npm install react-native-purchases`
 *   2. Create products in App Store Connect matching PLAN_IDS values
 *   3. Get RevenueCat API key and set REVENUECAT_IOS_KEY in app.config
 *   4. Replace stub implementation below with real Purchases SDK calls
 */

export const PLAN_IDS = {
  monthly: 'mapass_pro_monthly',
  annual: 'mapass_pro_annual',
} as const;

export type PlanId = keyof typeof PLAN_IDS;

export async function configurePurchases(userId: string | null): Promise<void> {
  // TODO: Purchases.configure({ apiKey: REVENUECAT_IOS_KEY, appUserID: userId });
  return;
}

export async function getOfferings(): Promise<any | null> {
  // TODO: return Purchases.getOfferings();
  return null;
}

export async function purchasePackage(planId: PlanId): Promise<void> {
  // TODO: real purchase via Purchases.purchasePackage
  // For now, block so dev builds don't silently "succeed":
  throw new Error(
    'Compras ainda não configuradas. Instale react-native-purchases e configure a RevenueCat.',
  );
}

export async function restorePurchases(): Promise<void> {
  // TODO: Purchases.restorePurchases();
  return;
}

export async function isPro(): Promise<boolean> {
  // TODO: check Purchases.getCustomerInfo().entitlements.active
  return false;
}
