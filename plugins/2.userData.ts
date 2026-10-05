export interface IUserData {
  os: string;
  personId: number | null;
  age: number | null;
}

export default defineNuxtPlugin((nuxtApp) => {
  const runtimeConfig = useRuntimeConfig();
  const { user } = nuxtApp.vueApp.config.globalProperties.$auth0;

  const userData: IUserData = {
    os: runtimeConfig.public.systemName,
    personId: null,
    age: null,
  };

  watch(
    user,
    () => {
      if (user.value !== undefined) {
        userData.personId = user.value["https://login.bcc.no/claims/personId"];
        const birthdate = user.value.birthdate?.toString();
        if (birthdate !== undefined) {
          const date = new Date(birthdate);
          // We don't want the current age, just the age at the end of the year.
          userData.age = new Date().getFullYear() - date.getFullYear();
        }
      }
    },
    { immediate: true },
  );

  return {
    provide: {
      userData,
    },
  };
});
