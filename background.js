chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  try {
    const url = new URL(tab.url);

    // 1. Read ALL cookies for the page URL (not just exact domain)
    const cookies = await chrome.cookies.getAll({
      url: url.origin
    });

    // 2. Attempt to extract tenant from known EBSCO / FOLIO patterns
    let tenant = null;

    for (const c of cookies) {
      // --- Pattern 1: explicit tenant cookies ---
      if (["folioTenant", "okapiTenant", "tenantId"].includes(c.name)) {
        tenant = c.value;
        break;
      }

      // --- Pattern 2: Keycloak identity cookies ---
      // EBSCO commonly encodes tenant in these
      if (c.name.startsWith("KEYCLOAK_") || c.name.startsWith("kc-")) {
        const decoded = decodeURIComponent(c.value);

        // Typical EBSCO tenant format: fs00009876
        const m = decoded.trim();
        if (m.length > 7) {
          tenant = m;
          break;
        }
      }
    }

    console.log("Detected FOLIO tenant:", tenant);

    // 3. Inject tenant into page for content.js
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (t) => {
        window.__FOLIO_TENANT_FROM_BG = t;
      },
      args: [tenant]
    });

    // 4. Inject scripts
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [
        "lib/folio-api.js",
        "content.js"
      ]
    });

  } catch (e) {
    console.error("Extension injection failed:", e);
  }
});
