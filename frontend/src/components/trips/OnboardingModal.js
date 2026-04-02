import { useState } from "react";
import { useLanguage } from "../../i18n/LanguageContext";

const STEPS = [
  {
    icon: "🔗",
    titleKey: "onboarding.step1Title",
    descKey: "onboarding.step1Desc",
    color: "from-coral-400 to-coral-500",
  },
  {
    icon: "📍",
    titleKey: "onboarding.step2Title",
    descKey: "onboarding.step2Desc",
    color: "from-blue-400 to-blue-500",
  },
  {
    icon: "✨",
    titleKey: "onboarding.step3Title",
    descKey: "onboarding.step3Desc",
    color: "from-violet-400 to-violet-500",
  },
  {
    icon: "🗺️",
    titleKey: "onboarding.step4Title",
    descKey: "onboarding.step4Desc",
    color: "from-emerald-400 to-emerald-500",
  },
  {
    icon: "💬",
    titleKey: "onboarding.step5Title",
    descKey: "onboarding.step5Desc",
    color: "from-amber-400 to-amber-500",
  },
  {
    icon: "🗺️",
    titleKey: "onboarding.step6Title",
    descKey: "onboarding.step6Desc",
    color: "from-cyan-400 to-cyan-500",
  },
  {
    icon: "✈️",
    titleKey: "onboarding.step7Title",
    descKey: "onboarding.step7Desc",
    color: "from-rose-400 to-rose-500",
  },
  {
    icon: "📤",
    titleKey: "onboarding.step8Title",
    descKey: "onboarding.step8Desc",
    color: "from-indigo-400 to-indigo-500",
  },
];

export default function OnboardingModal({ onClose }) {
  const { t } = useLanguage();
  const [step, setStep] = useState(0);

  const isLast = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Gradient accent bar */}
        <div className={`h-1.5 bg-gradient-to-r ${current.color}`} />

        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 pt-5 px-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                i === step
                  ? "w-8 bg-coral-500"
                  : i < step
                  ? "w-3 bg-coral-300"
                  : "w-3 bg-gray-200"
              }`}
            />
          ))}
        </div>

        {/* Step counter */}
        <div className="text-center mt-3">
          <span className="text-xs font-medium text-gray-400">
            {step + 1} / {STEPS.length}
          </span>
        </div>

        {/* Content */}
        <div className="px-8 py-5 text-center">
          <div className="text-5xl mb-4 animate-bounce-subtle">{current.icon}</div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">
            {t(current.titleKey)}
          </h2>
          <p className="text-gray-600 text-sm leading-relaxed">
            {t(current.descKey)}
          </p>
        </div>

        {/* Actions */}
        <div className="px-8 pb-6 flex items-center gap-3">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 text-gray-500 hover:text-gray-700 text-sm font-medium transition-colors"
            >
              {t("onboarding.back")}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-gray-600 text-sm transition-colors"
          >
            {t("onboarding.skip")}
          </button>
          <button
            onClick={() => (isLast ? onClose() : setStep(step + 1))}
            className="px-6 py-2.5 bg-coral-500 hover:bg-coral-400 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
          >
            {isLast ? t("onboarding.start") : t("onboarding.next")}
          </button>
        </div>
      </div>
    </div>
  );
}
