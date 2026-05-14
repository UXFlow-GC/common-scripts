/*
 * Webflow Cart Snapshot Bridge
 *
 * Purpose:
 *   Webflow-specific adapter for the generic cart-snapshot.js script.
 *   This script does not own cart storage. It reads Webflow DOM/cart drawer data
 *   and writes it through window.CartSnapshot.save(...).
 *
 * Load order:
 *   1. cart-snapshot.js
 *   2. webflow-cart-snapshot-bridge.js
 *
 * Optional config:
 * <script>
 *   window.WEBFLOW_CART_SNAPSHOT_CONFIG = {
 *     currency: "NZD",
 *     debug: true
 *   };
 * </script>
 */
(function () {
  "use strict";

  var DEFAULT_CONFIG = {
    currency: "NZD",
    debug: false,
    addToCartButtonSelector: ".w-commerce-commerceaddtocartbutton",
    cartListSelector: ".w-commerce-commercecartlist",
    cartItemSelector: ".w-commerce-commercecartitem",
    cartProductNameSelector: ".w-commerce-commercecartproductname",
    cartProductPriceSelector: ".w-commerce-commercecartproductprice",
    skuTextSelector: ".w-commerce-commercecartproductname.sku-item",
    quantityInputSelector: '[data-wf-cart-action="update-item-quantity"]',
    observeRetryDelays: [0, 500, 1500, 3000]
  };

  var config = Object.assign({}, DEFAULT_CONFIG, window.WEBFLOW_CART_SNAPSHOT_CONFIG || {});
  var observer = null;
  var syncTimer = null;

  onReady(function () {
    enrichAddToCartButtons();
    bindCartDrawerEvents();

    config.observeRetryDelays.forEach(function (delay) {
      setTimeout(function () {
        observeCartDrawer();
        syncCartSnapshotFromDrawer();
      }, delay);
    });
  });

  function enrichAddToCartButtons() {
    var buttons = document.querySelectorAll(config.addToCartButtonSelector);

    buttons.forEach(function (button) {
      var form = button.closest("form");
      if (!form) return;

      var productId = form.getAttribute("data-commerce-product-id") || "";
      var skuId = form.getAttribute("data-commerce-sku-id") || "";

      button.dataset.cartAdd = "";
      button.dataset.cartProductId = productId;
      button.dataset.cartVariantId = skuId;

      if (!button.dataset.cartProductCurrency) {
        button.dataset.cartProductCurrency = config.currency;
      }
    });

    log("Enriched add-to-cart buttons", buttons.length);
  }

  function bindCartDrawerEvents() {
    document.addEventListener("click", function (event) {
      if (event.target.closest(config.addToCartButtonSelector)) {
        scheduleSync(350);
        scheduleSync(1000);
      }

      if (event.target.closest('[data-wf-cart-action="remove-item"]')) {
        scheduleSync(100);
        scheduleSync(500);
      }
    }, true);

    document.addEventListener("change", function (event) {
      if (event.target.closest(config.quantityInputSelector)) {
        scheduleSync(100);
      }
    }, true);

    document.addEventListener("input", function (event) {
      if (event.target.closest(config.quantityInputSelector)) {
        scheduleSync(250);
      }
    }, true);
  }

  function observeCartDrawer() {
    var cartList = document.querySelector(config.cartListSelector);
    if (!cartList || observer) return;

    observer = new MutationObserver(function () {
      scheduleSync(100);
    });

    observer.observe(cartList, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["value", "data-commerce-sku-id"]
    });

    log("Cart drawer observer attached");
  }

  function syncCartSnapshotFromDrawer() {
    if (!window.CartSnapshot || typeof window.CartSnapshot.save !== "function") {
      warn("CartSnapshot is not loaded. Load cart-snapshot.js before this bridge.");
      return;
    }

    var items = readCartDrawerItems();

    window.CartSnapshot.save({
      version: 1,
      source: "webflow-cart-drawer",
      currency: config.currency,
      items: items
    });

    log("Synced cart snapshot from Webflow drawer", items);
  }

  function readCartDrawerItems() {
    var cartItems = Array.prototype.slice.call(document.querySelectorAll(config.cartItemSelector));

    return cartItems.map(function (cartItem) {
      var quantityInput = cartItem.querySelector(config.quantityInputSelector);

      var skuId =
        getAttr(quantityInput, "data-commerce-sku-id") ||
        getText(cartItem, config.skuTextSelector) ||
        "";

      var productName = getText(cartItem, config.cartProductNameSelector);
      var quantity = toPositiveInteger(quantityInput && quantityInput.value, 1);
      var price = readUnitPrice(cartItem, quantity);

      return {
        product_id: skuId,
        variant_id: skuId,
        product_name: productName,
        title: productName,
        quantity: quantity,
        price: price,
        currency: config.currency
      };
    }).filter(function (item) {
      return item.variant_id && item.quantity > 0;
    });
  }

  function readUnitPrice(cartItem, quantity) {
    var explicitPrice = getText(cartItem, config.cartProductPriceSelector);
    var parsedExplicitPrice = parseMoney(explicitPrice);

    if (parsedExplicitPrice > 0) return parsedExplicitPrice;

    var text = cartItem.textContent || "";
    var prices = text.match(/[$€£¥]?\s?\d[\d,]*(?:\.\d{2})?/g) || [];

    var parsedPrices = prices.map(parseMoney).filter(function (value) {
      return value > 0;
    });

    if (!parsedPrices.length) return 0;

    return roundMoney(parsedPrices[parsedPrices.length - 1]);
  }

  function scheduleSync(delay) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      observeCartDrawer();
      syncCartSnapshotFromDrawer();
    }, delay || 100);
  }

  function getText(scope, selector) {
    if (!scope) return "";
    var element = scope.querySelector(selector);
    return element ? element.textContent.trim() : "";
  }

  function getAttr(element, name) {
    return element ? element.getAttribute(name) || "" : "";
  }

  function parseMoney(value) {
    var cleaned = String(value || "")
      .replace(/[^0-9.,-]/g, "")
      .replace(/,/g, "");

    var number = Number(cleaned);
    return Number.isFinite(number) ? roundMoney(number) : 0;
  }

  function toPositiveInteger(value, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.round(number);
  }

  function roundMoney(value) {
    return Math.round(Number(value || 0) * 100) / 100;
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function log() {
    if (!config.debug) return;
    console.log.apply(console, ["[WebflowCartBridge]"].concat(Array.prototype.slice.call(arguments)));
  }

  function warn() {
    if (!config.debug) return;
    console.warn.apply(console, ["[WebflowCartBridge]"].concat(Array.prototype.slice.call(arguments)));
  }
})();
