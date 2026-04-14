(async function () {
  if (document.getElementById("folio-circ-modal-root")) return;

  console.log("FOLIO Circulation Rules: starting");

  const uiUrl = new URL(window.location.href);
  const apiHost = uiUrl.hostname.startsWith("api-")
    ? uiUrl.hostname
    : `api-${uiUrl.hostname}`;

  const apiBase = `${uiUrl.protocol}//${apiHost}`;

  /* ----------------------------------------------------
   * LOAD SAVED TENANT (chrome.storage.local)
   * -------------------------------------------------- */

  let savedTenant = "";
  try {
    const stored = await chrome.storage.local.get("folioTenant");
    if (stored.folioTenant) {
      savedTenant = stored.folioTenant;
      console.log("Loaded saved tenant:", savedTenant);
    }
  } catch (e) {
    console.warn("Could not load saved tenant:", e);
  }

  /* ----------------------------------------------------
   * MODAL UI
   * -------------------------------------------------- */

  const root = document.createElement("div");
  root.id = "folio-circ-modal-root";
  document.body.appendChild(root);
  const shadow = root.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <div class="overlay">
      <div class="modal">
        <h2>Circulation Rule Checker</h2>

        <label>FOLIO Tenant</label>
        <input id="tenantInput"
               placeholder="e.g. fs00009876"
               value="${savedTenant}">
        <div style="font-size:12px;color:#555;margin-top:4px">
          Tenant is required. It will be remembered for next time.
        </div>

        <label>User barcode</label>
        <input id="userBarcode">

        <label>Item barcode</label>
        <input id="itemBarcode">

        <div class="buttons">
          <button id="run">Run</button>
          <button id="close">Close</button>
        </div>

        <pre id="out">Ready.</pre>
      </div>
    </div>
  `;

  fetch(chrome.runtime.getURL("modal.css"))
    .then(r => r.text())
    .then(css => {
      const style = document.createElement("style");
      style.textContent = css;
      shadow.appendChild(style);
    });

  const $ = id => shadow.getElementById(id);
  $("close").onclick = () => root.remove();

  /* ----------------------------------------------------
   * MAIN LOGIC
   * -------------------------------------------------- */

  $("run").onclick = async () => {
    try {
      $("out").textContent = "Running…";

      const tenant = $("tenantInput").value.trim();
      if (!tenant) {
        throw new Error("Tenant is required (e.g. fs00009876).");
      }

      // ✅ Persist tenant for next time
      await chrome.storage.local.set({ folioTenant: tenant });
      console.log("Saved tenant:", tenant);

      window.folioApi.setSession({
        okapiUrl: apiBase,
        tenant,
        token: null
      });

      const userBarcode = $("userBarcode").value.trim();
      const itemBarcode = $("itemBarcode").value.trim();
      if (!userBarcode || !itemBarcode) {
        throw new Error("Both barcodes are required.");
      }

      const user = (await folioApi.folioGet(
        `/users?query=barcode==${encodeURIComponent(userBarcode)}`
      )).users?.[0];
      if (!user) throw new Error("User not found.");

      const item = (await folioApi.folioGet(
        `/inventory/items?query=barcode==${encodeURIComponent(itemBarcode)}`
      )).items?.[0];
      if (!item) throw new Error("Item not found.");

      const params =
        `item_type_id=${item.materialType.id}` +
        `&loan_type_id=${item.permanentLoanType.id}` +
        `&patron_type_id=${user.patronGroup}` +
        `&location_id=${item.effectiveLocation.id}`;

      const endpoints = [
        "/circulation/rules/loan-policy-all",
        "/circulation/rules/overdue-fine-policy-all",
        "/circulation/rules/lost-item-policy-all",
        "/circulation/rules/request-policy-all"
      ];

      const ruleSets = await Promise.all(
        endpoints.map(ep =>
          folioApi
            .folioGet(`${ep}?${params}`)
            .then(r =>
              r.circulationRuleMatches.map(m => m.circulationRuleLine)
            )
        )
      );

      const counts = {};
      ruleSets.flat().forEach(line => {
        counts[line] = (counts[line] || 0) + 1;
      });

      const matches = Object.entries(counts)
        .filter(([, c]) => c === 4)
        .map(([l]) => l);

      $("out").textContent = matches.length
        ? "✅ Matching circulation rule line(s):\n\n" + matches.join("\n")
        : "❌ No exact match found.";

    } catch (e) {
      $("out").textContent = "❌ Error:\n" + e.message;
    }
  };
})();
