import {
  viewport,
  miniApp,
  initData,
  $debug,
  init as initSDK,
} from "@telegram-apps/sdk-vue";

/**
 * Initializes the application and configures its dependencies.
 */
export function init(debug: boolean): void {
  // Set @telegram-apps/sdk-react debug mode.
  $debug.set(debug);

  // Initialize special event handlers for Telegram Desktop, Android, iOS, etc.
  // Also, configure the package.
  initSDK();

  // Add Eruda if needed.
  if (debug) {
    import("eruda").then((lib) => lib.default.init()).catch(console.error);
  }

  // Check if all required components are supported.
  if (!miniApp.isSupported()) {
    throw new Error("ERR_NOT_SUPPORTED");
  }

  // Mount all components used in the project.
  miniApp.mount();
  initData.restore();
  void viewport
    .mount()
    .catch((e) => {
      console.error("Something went wrong mounting the viewport", e);
    })
    .then(() => {
      viewport.bindCssVars();
    });
}
