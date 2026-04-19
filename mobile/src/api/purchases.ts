/**
 * RevenueCat integration for Mapass subscriptions.
 *
 * Before this works in production:
 *   1. Create products in App Store Connect with these identifiers:
 *      - mapass_pro_monthly
 *      - mapass_pro_annual
 *   2. Submit IAPs for Apple approval (~24-48h)
 *   3. Create RevenueCat project, connect to App Store Connect
 *   4. Create Entitlement "pro" with the two products
 *   5. Set EXPO_PUBLIC_REVENUECAT_IOS_KEY in .env from RevenueCat dashboard
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import Purchases, {
  CustomerInfo,
  PurchasesOffering,
  PurchasesPackage,
} from 'react-native-purchases';

export const PLAN_IDS = {
  monthly: 'mapass_pro_monthly',
  annual: 'mapass_pro_annual',
} as const;

export type PlanId = keyof typeof PLAN_IDS;

export const PRO_ENTITLEMENT = 'pro';

let configured = false;

function getApiKey(): string | undefined {
  if (Platform.OS === 'ios') {
    return (
      Constants.expoConfig?.extra?.revenueCatIosKey ??
      process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
    );
  }
  return (
    Constants.expoConfig?.extra?.revenueCatAndroidKey ??
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY
  );
}

export async function configurePurchases(userId: string | null): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn('[purchases] No RevenueCat API key, skipping configure');
    return;
  }
  if (configured) {
    if (userId) await Purchases.logIn(userId);
    return;
  }
  Purchases.configure({ apiKey, appUserID: userId ?? undefined });
  configured = true;
}

export async function getOfferings(): Promise<PurchasesOffering | null> {
  if (!configured) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

async function packageFor(planId: PlanId): Promise<PurchasesPackage | null> {
  const current = await getOfferings();
  if (!current) return null;
  const target = PLAN_IDS[planId];
  return (
    current.availablePackages.find(
      (p) => p.product.identifier === target,
    ) ?? null
  );
}

export async function purchasePackage(planId: PlanId): Promise<CustomerInfo> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'Compras ainda não configuradas. Entre em contato com o suporte.',
    );
  }
  if (!configured) {
    throw new Error('Purchases não configurado. Reinicie o app.');
  }
  const pkg = await packageFor(planId);
  if (!pkg) {
    throw new Error('Plano indisponível no momento.');
  }
  const { customerInfo } = await Purchases.purchasePackage(pkg);
  return customerInfo;
}

export async function restorePurchases(): Promise<CustomerInfo | null> {
  if (!configured) return null;
  return Purchases.restorePurchases();
}

export async function isPro(): Promise<boolean> {
  if (!configured) return false;
  try {
    const info = await Purchases.getCustomerInfo();
    return !!info.entitlements.active[PRO_ENTITLEMENT];
  } catch {
    return false;
  }
}

export async function logOutPurchases(): Promise<void> {
  if (!configured) return;
  try {
    await Purchases.logOut();
  } catch {}
}
