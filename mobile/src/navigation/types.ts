export type RootStackParamList = {
  Splash: undefined;
  Onboarding: undefined;
  Auth: undefined;
  Main: undefined;
  TripCreate: undefined;
  TripDetail: { tripId: number };
  LinkAnalysis: { tripId?: number };
  Chat: { tripId?: number };
  Share: { tripId: number };
  Paywall: undefined;
};

export type TabParamList = {
  Home: undefined;
  Analyze: undefined;
  Profile: undefined;
};
