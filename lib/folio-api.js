window.folioApi = (function () {
  let session = null;

  function setSession(s) {
    session = s;
    console.log("FOLIO API session set:", session);
  }

  function buildHeaders() {
    if (!session?.tenant) {
      throw new Error("X-Okapi-Tenant is required but missing");
    }

    const headers = {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "X-Okapi-Tenant": session.tenant
    };

    if (session.token) {
      headers["x-okapi-token"] = session.token;
    }

    return headers;
  }

  async function folioGet(path) {
    if (!session?.okapiUrl) {
      throw new Error("No API base URL configured");
    }

    const resp = await fetch(session.okapiUrl + path, {
      method: "GET",
      headers: buildHeaders(),
      credentials: "include"
    });

    const contentType = resp.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      const text = await resp.text();
      throw new Error(
        "API returned non-JSON response:\n" +
        text.slice(0, 300)
      );
    }

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`${resp.status}: ${text}`);
    }

    return resp.json();
  }

  return {
    setSession,
    folioGet
  };
})();
