import type { LanguageEnum } from "@bcc-code/bmm-sdk-fetch";

export const useProfileStore = defineStore(
  "profile",
  () => {
    const autoplay = ref(false);
    const uiLanguage = ref<LanguageEnum>("en");

    return {
      autoplay,
      uiLanguage,
    };
  },
  {
    persist: true,
  },
);
