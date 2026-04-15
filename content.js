(async function () {
  if (document.getElementById("folio-circ-modal-root")) return;

  console.log("FOLIO Circulation Rules: starting");

  /* ----------------------------------------------------
   * SESSION — retrieved from the background service worker
   * -------------------------------------------------- */

  var session = await new Promise(function (resolve) {
    chrome.runtime.sendMessage({ type: "circrules_getSession" }, resolve);
  });

  var sessionUrl = (session && session.url) || null;
  var sessionTenant = (session && session.tenant) || null;
  var sessionOrigin = (session && session.origin) || null;

  console.log("FOLIO Circulation Rules session:", session);

  /* ----------------------------------------------------
   * API HELPER — proxied through background service worker
   * -------------------------------------------------- */

  function apiFetch(path, params) {
    return new Promise(function (resolve, reject) {
      chrome.runtime.sendMessage({
        type: "circrules_apiFetch",
        method: "GET",
        path: path,
        params: params || null,
        sessionUrl: sessionUrl,
        sessionTenant: sessionTenant,
      }, function (resp) {
        if (!resp) { reject(new Error("No response from background")); return; }
        if (resp._error) { reject(new Error(resp.message)); return; }
        if (resp.ok === false) {
          reject(new Error("FOLIO API " + resp.status + " " + resp.statusText + "\n" + (resp.body || "").slice(0, 500)));
          return;
        }
        resolve(resp.data);
      });
    });
  }

  /* ----------------------------------------------------
   * MODAL UI
   * -------------------------------------------------- */

  var root = document.createElement("div");
  root.id = "folio-circ-modal-root";
  document.body.appendChild(root);
  var shadow = root.attachShadow({ mode: "open" });

  var statusLine = "";
  if (sessionTenant && sessionUrl) {
    statusLine = "Session detected — tenant: " + sessionTenant + "  gateway: " + sessionUrl;
  } else if (sessionTenant) {
    statusLine = "Tenant detected: " + sessionTenant + " (no API URL — configure in Settings)";
  } else {
    statusLine = "No session detected. Configure tenant and API URL in Settings.";
  }

  shadow.innerHTML =
    '<div class="overlay">' +
      '<div class="modal">' +
        '<h2>Circulation Rule Checker</h2>' +
        '<div id="sessionStatus" style="font-size:12px;margin-bottom:8px;color:#555"></div>' +
        '<div class="tabs">' +
          '<button class="tab active" data-tab="check">Check Rules</button>' +
          '<button class="tab" data-tab="settings">Settings</button>' +
        '</div>' +
        '<div id="tab-check" class="tab-content">' +
          '<label>User barcode</label>' +
          '<input id="userBarcode">' +
          '<label>Item barcode</label>' +
          '<input id="itemBarcode">' +
          '<div class="buttons">' +
            '<button id="run">Run</button>' +
            '<button id="close">Close</button>' +
          '</div>' +
          '<pre id="out">Ready.</pre>' +
        '</div>' +
        '<div id="tab-settings" class="tab-content" style="display:none">' +
          '<label>FOLIO API Gateway</label>' +
          '<input id="urlInput" placeholder="e.g. https://api-mytenant.folio.ebsco.com">' +
          '<label>FOLIO Tenant</label>' +
          '<input id="tenantInput" placeholder="e.g. fs00009876">' +
          '<div style="font-size:12px;color:#555;margin-top:4px">' +
            'Auto-detected from your FOLIO session. Override here if needed.' +
          '</div>' +
          '<div class="buttons">' +
            '<button id="closeSetting">Close</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  fetch(chrome.runtime.getURL("modal.css"))
    .then(function (r) { return r.text(); })
    .then(function (css) {
      var style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
    });

  function $(id) { return shadow.getElementById(id); }

  $("sessionStatus").textContent = statusLine;
  $("urlInput").value = sessionUrl || sessionOrigin || "";
  $("tenantInput").value = sessionTenant || "";
  $("close").onclick = function () { root.remove(); };
  $("closeSetting").onclick = function () { root.remove(); };

  /* --- Tab switching --- */
  var tabs = shadow.querySelectorAll(".tab");
  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      tabs.forEach(function (t) { t.classList.remove("active"); });
      btn.classList.add("active");
      shadow.querySelectorAll(".tab-content").forEach(function (tc) {
        tc.style.display = "none";
      });
      shadow.getElementById("tab-" + btn.getAttribute("data-tab")).style.display = "";
    });
  });

  /* ----------------------------------------------------
   * MAIN LOGIC
   * -------------------------------------------------- */

  $("run").onclick = async function () {
    try {
      $("out").textContent = "Running…";

      var tenant = $("tenantInput").value.trim();
      var url = $("urlInput").value.trim();
      if (!tenant) {
        throw new Error("Tenant is required. Configure it in the Settings tab.");
      }
      if (!url) {
        throw new Error("FOLIO API Gateway URL is required. Configure it in the Settings tab.");
      }

      // Update session for this run
      sessionUrl = url;
      sessionTenant = tenant;

      var userBarcode = $("userBarcode").value.trim();
      var itemBarcode = $("itemBarcode").value.trim();
      if (!userBarcode || !itemBarcode) {
        throw new Error("Both barcodes are required.");
      }

      var userData = await apiFetch("/users", { query: "barcode==" + userBarcode });
      var user = (userData.users || [])[0];
      if (!user) throw new Error("User not found.");

      var itemData = await apiFetch("/inventory/items", { query: "barcode==" + itemBarcode });
      var item = (itemData.items || [])[0];
      if (!item) throw new Error("Item not found.");

      var ruleParams = {
        item_type_id: item.materialType.id,
        loan_type_id: item.permanentLoanType.id,
        patron_type_id: user.patronGroup,
        location_id: item.effectiveLocation.id,
      };

      var endpoints = [
        "/circulation/rules/loan-policy-all",
        "/circulation/rules/overdue-fine-policy-all",
        "/circulation/rules/lost-item-policy-all",
        "/circulation/rules/request-policy-all"
      ];

      var ruleSets = await Promise.all(
        endpoints.map(function (ep) {
          return apiFetch(ep, ruleParams).then(function (r) {
            return (r.circulationRuleMatches || []).map(function (m) {
              return m.circulationRuleLine;
            });
          });
        })
      );

      var counts = {};
      ruleSets.forEach(function (lines) {
        lines.forEach(function (line) {
          counts[line] = (counts[line] || 0) + 1;
        });
      });

      var matches = [];
      Object.keys(counts).forEach(function (line) {
        if (counts[line] === 4) matches.push(line);
      });

      $("out").textContent = matches.length
        ? "✅ Matching circulation rule line(s):\n\n" + matches.join("\n")
        : "❌ No exact match found.";

    } catch (e) {
      $("out").textContent = "❌ Error:\n" + e.message;
    }
  };
})();
