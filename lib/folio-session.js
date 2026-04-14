window.folioSession = (function () {

  function getAllSessions() {
    return new Promise((resolve) => {

      function handler(event) {
        if (event.data?.source !== "folio-session-page") return;
        window.removeEventListener("message", handler);
        resolve(event.data.sessions || []);
      }

      window.addEventListener("message", handler);

      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("lib/folio-session-page.js");
      script.onload = () => script.remove();
      document.documentElement.appendChild(script);
    });
  }

  return { getAllSessions };
})();
