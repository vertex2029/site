(function () {
  "use strict";

  var REPO_BASE = "https://raw.githubusercontent.com/vertex2029/vertex-providers/main";
  var MANIFEST_REMOTE = REPO_BASE + "/manifest.json";

  var state = {
    providers: [],
    activeType: "all",
    search: "",
    showDisabled: false,
    activeQrUrl: MANIFEST_REMOTE,
    activeQrLabel: "Manifest JSON",
  };

  var els = {
    stats: document.getElementById("stats"),
    grid: document.getElementById("provider-grid"),
    filters: document.getElementById("type-filters"),
    search: document.getElementById("search-input"),
    showDisabled: document.getElementById("show-disabled"),
    banner: document.getElementById("status-banner"),
    qrCanvas: document.getElementById("qr-canvas"),
    qrCaption: document.getElementById("qr-caption"),
    qrValue: document.getElementById("qr-value"),
    qrCopyBtn: document.getElementById("qr-copy-btn"),
    qrDownloadBtn: document.getElementById("qr-download-btn"),
    manifestPre: document.getElementById("manifest-pre"),
    manifestCode: document.getElementById("manifest-code"),
    toggleManifestBtn: document.getElementById("toggle-manifest-btn"),
    copyManifestJsonBtn: document.getElementById("copy-manifest-json-btn"),
    toast: document.getElementById("toast"),
  };

  var toastTimer = null;
  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      els.toast.classList.remove("show");
    }, 1800);
  }

  async function copyText(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        showToast("Copied " + label);
        return;
      } catch (e) {
        // Fallback for non-HTTPS LAN / WebView contexts
      }
    }
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      ta.style.fontSize = "16px";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand("copy");
      ta.parentNode && ta.parentNode.removeChild(ta);
      showToast(ok ? "Copied " + label : "Copy failed");
    } catch (err) {
      showToast("Copy failed: " + err.message);
    }
  }

  function updateQr(url, label) {
    state.activeQrUrl = url;
    state.activeQrLabel = label;
    els.qrCaption.textContent = label + " — scan with your phone or TV camera.";
    els.qrValue.textContent = url;
    els.qrValue.title = url;
    try {
      window.VertexQR.renderQrToCanvas(els.qrCanvas, url);
    } catch (err) {
      showToast("QR error: " + err.message);
    }
  }

  async function loadManifest() {
    var candidates = ["../manifest.json", "./manifest.json", MANIFEST_REMOTE];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var res = await fetch(candidates[i]);
        if (!res.ok) continue;
        var data = await res.json();
        if (Array.isArray(data)) return data;
      } catch (e) {
        // Try next manifest source
      }
    }
    throw new Error("Could not load manifest.json");
  }

  function providerCatalogUrl(item) {
    return REPO_BASE + "/dist/" + item.value + "/catalog.js";
  }

  function renderStats() {
    var total = state.providers.length;
    var active = state.providers.filter(function (p) { return !p.disabled; }).length;
    var disabled = total - active;
    els.stats.innerHTML =
      '<span class="stat-pill">Total: ' + total + "</span>" +
      '<span class="stat-pill">Active: ' + active + "</span>" +
      '<span class="stat-pill">Disabled: ' + disabled + "</span>";
  }

  function renderTypeFilters() {
    var counts = { all: state.providers.length };
    state.providers.forEach(function (p) {
      var t = p.type || "other";
      counts[t] = (counts[t] || 0) + 1;
    });

    els.filters.innerHTML = "";
    Object.keys(counts).forEach(function (type) {
      var btn = document.createElement("button");
      btn.className = "btn" + (state.activeType === type ? " is-active" : "");
      btn.textContent = type + " (" + counts[type] + ")";
      btn.addEventListener("click", function () {
        state.activeType = type;
        renderTypeFilters();
        renderProviders();
      });
      els.filters.appendChild(btn);
    });
  }

  function renderProviders() {
    var query = state.search.trim().toLowerCase();
    var items = state.providers.filter(function (p) {
      if (!state.showDisabled && p.disabled) return false;
      if (state.activeType !== "all" && (p.type || "other") !== state.activeType) return false;
      if (!query) return true;
      return (
        (p.display_name || "").toLowerCase().includes(query) ||
        (p.value || "").toLowerCase().includes(query) ||
        (p.type || "").toLowerCase().includes(query)
      );
    });

    els.grid.innerHTML = "";
    if (items.length === 0) {
      els.banner.textContent = "No providers match your current filter.";
      els.banner.classList.remove("hidden");
      return;
    }
    els.banner.classList.add("hidden");

    items.forEach(function (item) {
      var card = document.createElement("article");
      card.className = "card" + (item.disabled ? " card-disabled" : "");

      var top = document.createElement("div");
      top.className = "card-top";

      if (item.icon) {
        var img = document.createElement("img");
        img.className = "card-icon";
        img.src = item.icon;
        img.alt = item.display_name;
        img.loading = "lazy";
        img.onerror = function () {
          var fb = document.createElement("span");
          fb.className = "card-fallback";
          fb.textContent = (item.display_name || item.value || "?").slice(0, 2).toUpperCase();
          if (img.parentNode) img.parentNode.replaceChild(fb, img);
        };
        top.appendChild(img);
      } else {
        var fb = document.createElement("span");
        fb.className = "card-fallback";
        fb.textContent = (item.display_name || item.value || "?").slice(0, 2).toUpperCase();
        top.appendChild(fb);
      }

      var titleWrap = document.createElement("div");
      var h3 = document.createElement("h3");
      h3.className = "card-title";
      h3.textContent = item.display_name || item.value;
      var idEl = document.createElement("div");
      idEl.className = "card-id";
      idEl.textContent = item.value + " · v" + item.version;
      titleWrap.appendChild(h3);
      titleWrap.appendChild(idEl);
      top.appendChild(titleWrap);
      card.appendChild(top);

      var tags = document.createElement("div");
      tags.className = "card-tags";
      tags.innerHTML =
        '<span class="tag">' + escapeHtml(item.type || "global") + "</span>" +
        '<span class="tag ' + (item.disabled ? "tag-off" : "tag-ok") + '">' +
        (item.disabled ? "Disabled" : "Active") + "</span>" +
        (item.hasSettings ? '<span class="tag">Settings</span>' : "");
      card.appendChild(tags);

      var actions = document.createElement("div");
      actions.className = "card-actions";
      var bundleUrl = providerCatalogUrl(item);

      var copyBtn = document.createElement("button");
      copyBtn.className = "btn";
      copyBtn.textContent = "Copy Link";
      copyBtn.addEventListener("click", function () {
        copyText(bundleUrl, item.display_name + " link");
      });

      var qrBtn = document.createElement("button");
      qrBtn.className = "btn";
      qrBtn.textContent = "QR";
      qrBtn.addEventListener("click", function () {
        updateQr(bundleUrl, item.display_name + " (catalog.js)");
        var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        try {
          els.qrCanvas.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
        } catch (e) {
          els.qrCanvas.scrollIntoView();
        }
      });

      actions.appendChild(copyBtn);
      actions.appendChild(qrBtn);
      card.appendChild(actions);

      els.grid.appendChild(card);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wireEvents() {
    document.querySelectorAll("[data-copy-target]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-copy-target"));
        if (target) copyText(target.textContent.trim(), "link");
      });
    });

    document.querySelectorAll("[data-qr-target]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-qr-target"));
        var label = btn.getAttribute("data-qr-label") || "Link";
        if (target) updateQr(target.textContent.trim(), label);
      });
    });

    els.qrCopyBtn.addEventListener("click", function () {
      copyText(state.activeQrUrl, state.activeQrLabel);
    });

    els.qrDownloadBtn.addEventListener("click", function () {
      var dataUrl = els.qrCanvas.toDataURL("image/png");
      var link = document.createElement("a");
      link.download = "vertex-providers-qr.png";
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      link.parentNode && link.parentNode.removeChild(link);
    });

    els.toggleManifestBtn.addEventListener("click", function () {
      var isHidden = els.manifestPre.classList.toggle("hidden");
      els.toggleManifestBtn.textContent = isHidden ? "Show JSON" : "Hide JSON";
      els.toggleManifestBtn.setAttribute("aria-expanded", String(!isHidden));
    });

    els.copyManifestJsonBtn.addEventListener("click", function () {
      copyText(JSON.stringify(state.providers, null, 2), "manifest.json");
    });

    els.search.addEventListener("input", function () {
      state.search = els.search.value;
      renderProviders();
    });

    els.showDisabled.addEventListener("change", function () {
      state.showDisabled = els.showDisabled.checked;
      renderProviders();
    });
  }

  async function init() {
    wireEvents();
    updateQr(state.activeQrUrl, state.activeQrLabel);

    try {
      state.providers = await loadManifest();
      els.manifestCode.textContent = JSON.stringify(state.providers, null, 2);
      renderStats();
      renderTypeFilters();
      renderProviders();
    } catch (err) {
      els.banner.textContent = "Failed to load manifest.json: " + err.message;
      els.banner.classList.remove("hidden");
    }
  }

  init();
})();
