(function (global) {
  function initResponsiveAds(options) {
    const config = options || {};
    const desktopMinWidth = Number(config.desktopMinWidth ?? 1024);
    const mobileMaxWidth = Number(config.mobileMaxWidth ?? desktopMinWidth - 1);
    const refreshMs = Number(config.refreshMs ?? 60000);
    const bodyMobileClass = config.bodyMobileClass || "has-mobile-top-ad";

    const desktop = {
      key: config.desktopKey || "8098debbdf01cc9dd68a416d4088bbab",
      width: Number(config.desktopWidth ?? 160),
      height: Number(config.desktopHeight ?? 600),
      slot:
        typeof config.desktopSlot === "string"
          ? document.querySelector(config.desktopSlot)
          : config.desktopSlot,
      shell:
        typeof config.desktopShell === "string"
          ? document.querySelector(config.desktopShell)
          : config.desktopShell,
      failTimer: null,
      blocked: false,
    };

    const mobile = {
      key: config.mobileKey || "f1f67fc08c6c6b4dacd8faa8d73f0121",
      width: Number(config.mobileWidth ?? 468),
      height: Number(config.mobileHeight ?? 60),
      slot:
        typeof config.mobileSlot === "string"
          ? document.querySelector(config.mobileSlot)
          : config.mobileSlot,
      shell:
        typeof config.mobileShell === "string"
          ? document.querySelector(config.mobileShell)
          : config.mobileShell,
      failTimer: null,
      blocked: false,
    };

    if (!desktop.slot || !desktop.shell || !mobile.slot || !mobile.shell) return null;

    if (typeof global.__responsiveAdsCleanup === "function") {
      try {
        global.__responsiveAdsCleanup();
      } catch (_error) {}
    }

    const fallbackHref = config.fallbackHref || "/";
    const fallbackImage = config.fallbackImage || "/logo1.png";

    let refreshTimer = null;
    let lastShowDesktop = null;
    let lastShowMobile = null;

    function isDesktopResolution() {
      return global.matchMedia(`(min-width: ${desktopMinWidth}px)`).matches;
    }

    function isMobileResolution() {
      return global.matchMedia(`(max-width: ${mobileMaxWidth}px)`).matches;
    }

    function clearAd(ad) {
      if (ad.failTimer) {
        global.clearTimeout(ad.failTimer);
        ad.failTimer = null;
      }
      ad.slot.innerHTML = "";
    }

    function renderFallback(ad) {
      const fallbackWidth = ad.width;
      const fallbackHeight = ad.height;
      ad.slot.innerHTML =
        `<a href="${fallbackHref}" target="_blank" rel="noopener noreferrer" style="display:block; width:100%; max-width:${fallbackWidth}px; height:${fallbackHeight}px;"><img src="${fallbackImage}" alt="Conquiguias" style="width:100%; height:${fallbackHeight}px; object-fit:cover; display:block;"></a>`;
    }

    function mountAd(ad) {
      const configScript = document.createElement("script");
      configScript.text = `
        atOptions = {
          'key' : '${ad.key}',
          'format' : 'iframe',
          'height' : ${ad.height},
          'width' : ${ad.width},
          'params' : {}
        };
      `;
      ad.slot.appendChild(configScript);

      const invokeScript = document.createElement("script");
      invokeScript.src = `https://www.highperformanceformat.com/${ad.key}/invoke.js?ts=${Date.now()}`;
      invokeScript.async = true;
      invokeScript.onerror = function () {
        ad.blocked = true;
        renderFallback(ad);
      };
      ad.slot.appendChild(invokeScript);

      ad.failTimer = global.setTimeout(function () {
        const iframe = ad.slot.querySelector("iframe");
        if (!iframe) {
          renderFallback(ad);
        }
      }, 12000);
    }

    function setVisible(ad, visible) {
      ad.shell.hidden = !visible;
      ad.shell.setAttribute("aria-hidden", visible ? "false" : "true");
    }

    function refreshAds(forceRemount) {
      const showDesktop = isDesktopResolution();
      const showMobile = isMobileResolution();
      const desktopChanged = lastShowDesktop !== showDesktop;
      const mobileChanged = lastShowMobile !== showMobile;

      lastShowDesktop = showDesktop;
      lastShowMobile = showMobile;

      document.body.classList.toggle(bodyMobileClass, showMobile);

      setVisible(desktop, showDesktop);
      setVisible(mobile, showMobile);

      const shouldRemountDesktop = !!forceRemount || desktopChanged;
      const shouldRemountMobile = !!forceRemount || mobileChanged;

      if (showDesktop) {
        if (shouldRemountDesktop) {
          clearAd(desktop);
          if (desktop.blocked) {
            renderFallback(desktop);
          } else {
            mountAd(desktop);
          }
        }
      } else {
        clearAd(desktop);
      }

      if (showMobile) {
        if (shouldRemountMobile) {
          clearAd(mobile);
          if (mobile.blocked) {
            renderFallback(mobile);
          } else {
            mountAd(mobile);
          }
        }
      } else {
        clearAd(mobile);
      }
    }

    function handleResize() {
      refreshAds(false);
    }

    function cleanup() {
      if (refreshTimer) {
        global.clearInterval(refreshTimer);
        refreshTimer = null;
      }
      if (desktop.failTimer) global.clearTimeout(desktop.failTimer);
      if (mobile.failTimer) global.clearTimeout(mobile.failTimer);
      global.removeEventListener("resize", handleResize);
      global.removeEventListener("beforeunload", cleanup);
    }

    refreshAds(true);
    refreshTimer = global.setInterval(function () {
      refreshAds(true);
    }, refreshMs);

    global.addEventListener("resize", handleResize, { passive: true });
    global.addEventListener("beforeunload", cleanup);

    global.__responsiveAdsCleanup = cleanup;
    return cleanup;
  }

  global.initResponsiveAds = initResponsiveAds;
})(window);
