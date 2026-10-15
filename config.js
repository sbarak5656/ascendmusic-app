/* Build-time configuration.
   contentUrl / uiUrl: where the app looks for live plan and interface updates.
   - Web app: relative paths work.
   - Android app: build_apk.ps1 rewrites this file with the absolute https addresses of the hosted site.
   studioUrl: the claude.ai version of the app, where lessons are built. */
window.APP_CONFIG = {
  contentUrl: "content.json",
  uiUrl: "ui.json",
  studioUrl: "https://claude.ai/artifact/E63Nz5wcT78tWL1BaS5vJV"
};
