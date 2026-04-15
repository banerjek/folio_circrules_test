// background.js — Service worker for FOLIO Circulation Rules Checker.
// Imports the reusable folio-session library and adds icon-click + API proxy handlers.

/* global chrome, FolioSession, importScripts */

importScripts("lib/folio-session.js", "lib/folio-session-background.js");

FolioSession.setLogPrefix("[CircRules]");

// ======================== ICON CLICK → DETECT + INJECT ========================

chrome.action.onClicked.addListener(async function (tab) {
  // 1. Ensure host permission for the active tab's origin AND likely gateway
  //    siblings so cookie detection can find folioAccessToken on the API domain.
  var tabUrl = (tab && tab.url) || "";
  if (tabUrl) {
    try {
      var u = new URL(tabUrl);
      var host = u.hostname;
      var parts = host.split(".");
      var first = parts[0];
      var rest = parts.slice(1).join(".");
      var origins = [u.origin + "/*"];
      // Add api- prefix and -okapi suffix variants (covers EBSCO and dev.folio.org patterns)
      if (!isGatewayHost(host)) {
        origins.push(u.protocol + "//api-" + first + "." + rest + "/*");
        origins.push(u.protocol + "//" + first + "-okapi." + rest + "/*");
      }
      await new Promise(function (resolve) {
        chrome.permissions.request({ origins: origins }, resolve);
      });
    } catch (e) {
      console.warn("[CircRules] Permission request failed:", e.message);
    }
  }

  // 2. Detect session using the full FolioSession library (MAIN world + cookies)
  try {
    await FolioSession.detect();
  } catch (e) {
    console.warn("[CircRules] Session detection error:", e.message);
  }

  // 3. Store detected session for the content script.
  //    If detection found a gateway URL, use it. Otherwise, infer from tab URL.
  var detectedUrl = FolioSession.getUrl();
  var origin = null;
  try { origin = new URL(tabUrl).origin; } catch (_) { /* ignore */ }

  // If no gateway URL detected but we have a tab URL, try the api- prefix convention
  if (!detectedUrl && origin) {
    try {
      var tabHost = new URL(tabUrl).hostname;
      if (!isGatewayHost(tabHost)) {
        var parts = tabHost.split(".");
        parts[0] = "api-" + parts[0];
        detectedUrl = new URL(tabUrl).protocol + "//" + parts.join(".");
      } else {
        detectedUrl = origin;
      }
    } catch (_) { /* ignore */ }
  }

  await chrome.storage.session.set({
    _circrules_session: {
      url: detectedUrl,
      tenant: FolioSession.getTenant(),
      token: FolioSession.getToken(),
      origin: origin,
    },
  });

  // 3b. Request host permission for the gateway origin if it differs from the tab
  //     (still within the user-gesture window from the icon click)
  if (detectedUrl) {
    try {
      var gwOriginForPerm = new URL(detectedUrl).origin;
      if (gwOriginForPerm !== origin) {
        await new Promise(function (resolve) {
          chrome.permissions.request({ origins: [gwOriginForPerm + "/*"] }, resolve);
        });
      }
    } catch (_) { /* ignore */ }
  }

  // 4. Inject CSS + content script
  try {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      files: ["modal.css"],
    });
  } catch (_) {
    // CSS may already be injected
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["content.js"],
  });
});

// ======================== MESSAGE HANDLERS ========================

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (msg.type === "circrules_getSession") {
    chrome.storage.session.get("_circrules_session", function (data) {
      sendResponse(data._circrules_session || null);
    });
    return true;
  }

  if (msg.type === "circrules_apiFetch") {
    // Proxy API calls through the background using FolioSession's auth context.
    handleApiFetch(msg)
      .then(function (result) { sendResponse(result); })
      .catch(function (err) { sendResponse({ _error: true, message: err.message }); });
    return true;
  }

  // folioDetectCookies is handled by folio-session-background.js
});

// ======================== ECS TENANT SWITCH DETECTION ========================
// In ECS FOLIO environments, users can switch tenants within the UI.
// Watch for cookie changes that signal a tenant context switch and update
// the stored session so the content script stays in sync.

chrome.cookies.onChanged.addListener(function (changeInfo) {
  if (changeInfo.removed) return;

  var cookie = changeInfo.cookie;
  var name = cookie.name;

  // Only care about FOLIO session-related cookies
  if (name !== "folioAccessToken" && name !== "okapiToken" &&
      name !== "folioTenant" && name !== "okapiTenant") return;

  var newTenant = null;

  if (name === "folioTenant" || name === "okapiTenant") {
    newTenant = cookie.value;
  } else {
    // Extract tenant from JWT
    try {
      var parts = cookie.value.split(".");
      if (parts.length >= 2) {
        var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload.iss) {
          try {
            var issPath = new URL(payload.iss).pathname;
            var segments = issPath.split("/").filter(Boolean);
            if (segments.length >= 2 && segments[segments.length - 2] === "realms") {
              newTenant = segments[segments.length - 1];
            }
          } catch (_) { /* not a URL */ }
        }
      }
    } catch (_) { /* decode error */ }
  }

  if (!newTenant) return;

  // Update stored session with the new tenant
  chrome.storage.session.get("_circrules_session", function (data) {
    var session = data._circrules_session;
    if (!session) return;
    if (session.tenant === newTenant) return;

    console.log("[CircRules] ECS tenant switch detected:", session.tenant, "→", newTenant);
    session.tenant = newTenant;
    FolioSession.setTenant(newTenant);
    chrome.storage.session.set({ _circrules_session: session });
  });
});

// ======================== GATEWAY URL HELPERS ========================

// Known API gateway prefixes and suffixes on the first subdomain label.
var GATEWAY_PREFIXES = ["api-", "okapi-", "kong-"];
var GATEWAY_SUFFIXES = ["-api", "-okapi", "-kong"];

// Return true if the hostname looks like an API gateway host.
function isGatewayHost(hostname) {
  var first = hostname.split(".")[0];
  for (var i = 0; i < GATEWAY_PREFIXES.length; i++) {
    if (first.indexOf(GATEWAY_PREFIXES[i]) === 0) return true;
  }
  for (var j = 0; j < GATEWAY_SUFFIXES.length; j++) {
    if (first.length > GATEWAY_SUFFIXES[j].length &&
        first.lastIndexOf(GATEWAY_SUFFIXES[j]) === first.length - GATEWAY_SUFFIXES[j].length) return true;
  }
  return false;
}

// Strip gateway prefix/suffix from a hostname to get the base UI hostname.
function stripGatewayLabel(hostname) {
  var parts = hostname.split(".");
  var first = parts[0];
  for (var i = 0; i < GATEWAY_PREFIXES.length; i++) {
    if (first.indexOf(GATEWAY_PREFIXES[i]) === 0) {
      parts[0] = first.substring(GATEWAY_PREFIXES[i].length);
      return parts.join(".");
    }
  }
  for (var j = 0; j < GATEWAY_SUFFIXES.length; j++) {
    if (first.length > GATEWAY_SUFFIXES[j].length &&
        first.lastIndexOf(GATEWAY_SUFFIXES[j]) === first.length - GATEWAY_SUFFIXES[j].length) {
      parts[0] = first.substring(0, first.length - GATEWAY_SUFFIXES[j].length);
      return parts.join(".");
    }
  }
  return hostname;
}

// ======================== API PROXY ========================

async function handleApiFetch(msg) {
  if (msg.sessionUrl) FolioSession.setUrl(msg.sessionUrl);
  if (msg.sessionTenant) FolioSession.setTenant(msg.sessionTenant);

  // Ensure host permission for the gateway before making the request
  var gwOrigin = null;
  try { gwOrigin = new URL(FolioSession.getUrl()).origin; } catch (_) {}
  if (gwOrigin) {
    var hasPermission = await FolioSession.hasHostPermission(gwOrigin);
    if (!hasPermission) {
      console.warn("[CircRules] No host permission for", gwOrigin,
        "— grant access by clicking the extension icon while on the FOLIO tab.");
    }
  }

  var method = (msg.method || "GET").toUpperCase();
  var path = msg.path;
  var params = msg.params || null;
  var body = msg.body || null;

  if (method === "GET") {
    var data = await FolioSession.folioGet(path, params);
    return { ok: true, data: data };
  }

  // POST / PUT — build manually using FolioSession's headers
  var url = new URL(path, FolioSession.getUrl());
  if (params) {
    Object.keys(params).forEach(function (key) {
      var value = params[key];
      if (Array.isArray(value)) {
        value.forEach(function (v) { url.searchParams.append(key, v); });
      } else if (value != null) {
        url.searchParams.set(key, String(value));
      }
    });
  }

  var headers = FolioSession.buildHeaders();
  var token = FolioSession.getToken();
  if (token) {
    headers["x-okapi-token"] = token;
  }

  var opts = {
    method: method,
    headers: headers,
    credentials: "include",
  };
  if (body != null) {
    opts.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  var resp = await fetch(url.toString(), opts);
  var respText = "";
  try {
    respText = await resp.text();
  } catch (_) {
    // ignore
  }

  if (!resp.ok) {
    return {
      ok: false,
      status: resp.status,
      statusText: resp.statusText,
      body: respText,
    };
  }

  var ct = resp.headers.get("content-type") || "";
  if (ct.indexOf("json") !== -1 && respText) {
    return { ok: true, data: JSON.parse(respText) };
  }
  return { ok: true, data: respText || null };
}
