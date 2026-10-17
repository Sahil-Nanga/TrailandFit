import { defineConfig } from "wxt";

// Host access is never granted at install. Users opt in per shop from the popup, which
// requests that one site at runtime; these patterns only define what *may* be requested.
const OPTIONAL_HOSTS = ["https://*/*", "http://*/*"];

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: ({ manifestVersion }) => ({
    name: "Trialandfit",
    description: "Your body measurements on any clothing site, with size suggestions from the shop's size chart.",
    // activeTab + scripting: read the current tab when you open the popup.
    // storage: your session and preferences. Nothing else at install.
    permissions: ["activeTab", "scripting", "storage"],
    // Firefox's MV2 build has no optional_host_permissions; hosts go in optional_permissions.
    ...(manifestVersion === 3
      ? { optional_host_permissions: OPTIONAL_HOSTS }
      : { optional_permissions: OPTIONAL_HOSTS }),
  }),
});
