(function () {
  try {
    // Webpack runtime hook (used by Stripes)
    if (typeof __webpack_require__ !== "function") {
      window.postMessage(
        { source: "folio-session-page", session: null },
        "*"
      );
      return;
    }

    // Try to locate Stripes core config
    let stripesCore = null;

    for (const k of Object.keys(__webpack_require__.c || {})) {
      const mod = __webpack_require__.c[k]?.exports;
      if (mod?.okapi && mod?.tenant) {
        stripesCore = mod;
        break;
      }
    }

    if (!stripesCore) {
      window.postMessage(
        { source: "folio-session-page", session: null },
        "*"
      );
      return;
    }

    window.postMessage(
      {
        source: "folio-session-page",
        session: {
          okapiUrl: stripesCore.okapi.url,
          tenant: stripesCore.tenant,
          token: null
        }
      },
      "*"
    );
  } catch {
    window.postMessage(
      { source: "folio-session-page", session: null },
      "*"
    );
  }
})();
