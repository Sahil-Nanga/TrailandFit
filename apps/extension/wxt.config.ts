import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Aurora Fitting Room",
    description: "Your body measurements on any clothing site, and a quick way to save items.",
    // Minimum permissions: the current tab's URL/title only when you open the popup, plus
    // local storage for your session and preferences. No host permissions, no content scripts.
    permissions: ["activeTab", "storage"],
  },
});
