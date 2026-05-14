/*
 * Cart Snapshot Script
 *
 * Purpose:
 *   Store a lightweight, platform-agnostic cart snapshot in localStorage.
 *   Designed for Webflow-style sites, but generic enough for other storefront scripts.
 *
 * Install after product markup is available. Site-wide is okay.
 *
 * Example config:
 * <script>
 *   window.CART_SNAPSHOT_CONFIG = {
 *     storageKey: "cart_snapshot",
 *     currency: "AUD",
 *     debug: false
 *   };
 * </script>
 * <script src="https://cdn.jsdelivr.net/gh/UXFlow-GC/common-scripts@v1.0.0/cart-snapshot.js" defer></script>
 *
 * Product/Add-to-cart markup:
 * <button
 *   data-cart-add
 *   data-cart-product-id="dehydrator-10-tray"
 *   data-cart-variant-id="dehydrator-10-tray-black"
 *   data-cart-product-name="10 Tray Dehydrator"
 *   data-cart-product-price="499"
 *   data-cart-product-currency="AUD"
 *   data-cart-product-quantity="1"
 * >
 *   Add to cart
 * </button>
 *
 * Optional quantity input near the button:
 * <input data-cart-quantity-input type="number" value="1" min="1">
 *
 * Public API:
 *   window.CartSnapshot.get()
 *   window.CartSnapshot.addItem(item)
 *   window.CartSnapshot.updateItem(idOrVariantId, patch)
 *   window.CartSnapshot.removeItem(idOrVariantId)
 *   window.CartSnapshot.clear()
 *   window.CartSnapshot.toCheckoutPayload()
 */
(function () {
  "use strict";

  var DEFAULT_CONFIG = {
    storageKey: "cart_snapshot",
    currency: "AUD",
    debug: false,
    addToCartSelector: "[data-cart-add]",
    quantityInputSelector: "[data-cart-quantity-input]",
    removeFromCartSelector: "[data-cart-remove]",
    clearCartSelector: "[data-cart-clear]"
  };

  var config = Object.assign({}, DEFAULT_CONFIG, window.CART_SNAPSHOT_CONFIG || {});

  window.CartSnapshot = window.CartSnapshot || {};
  Object.assign(window.CartSnapshot, {
    get: getCart,
    save: saveCart,
    addItem: addItem,
    updateItem: updateItem,
    removeItem: removeItem,
    clear: clearCart,
    toCheckoutPayload: toCheckoutPayload,
    config: config
  });

  document.addEventListener("click", handleDocumentClick, true);

  function handleDocumentClick(event) {
    var addButton = event.target.closest(config.addToCartSelector);
    if (addButton) {
      addItem(readItemFromElement(addButton));
      return;
    }

    var removeButton = event.target.closest(config.removeFromCartSelector);
    if (removeButton) {
      removeItem(removeButton.getAttribute("data-cart-product-id") || removeButton.getAttribute("data-cart-variant-id"));
      return;
    }

    var clearButton = event.target.closest(config.clearCartSelector);
    if (clearButton) {
      clearCart();
    }
  }

  function readItemFromElement(element) {
    var quantity = readQuantity(element);
    var productId = attr(element, "data-cart-product-id") || attr(element, "data-product-id") || attr(element, "data-commerce-sku-id") || "";
    var variantId = attr(element, "data-cart-variant-id") || attr(element, "data-variant-id") || productId;
    var name = attr(element, "data-cart-product-name") || attr(element, "data-product-name") || readNearbyText(element, "[data-cart-product-name]") || document.title;
    var price = parseMoney(attr(element, "data-cart-product-price") || attr(element, "data-product-price") || readNearbyText(element, "[data-cart-product-price]"));
    var currency = attr(element, "data-cart-product-currency") || attr(element, "data-currency") || config.currency;

    return normalizeItem({
      product_id: productId,
      variant_id: variantId,
      product_name: name,
      title: name,
      quantity: quantity,
      price: price,
      currency: currency
    });
  }

  function readQuantity(element) {
    var explicit = attr(element, "data-cart-product-quantity") || attr(element, "data-quantity");
    if (explicit) return positiveNumber(explicit, 1);

    var scope = element.closest("form") || element.closest("[data-cart-product]") || document;
    var quantityInput = scope.querySelector(config.quantityInputSelector) || scope.querySelector("input[type='number'][name*='quantity' i]");

    return positiveNumber(quantityInput && quantityInput.value, 1);
  }

  function addItem(rawItem) {
    var item = normalizeItem(rawItem);
    if (!item.product_id && !item.variant_id) {
      warn("Cannot add cart item without product_id or variant_id", rawItem);
      return getCart();
    }

    var cart = getCart();
    var key = item.variant_id || item.product_id;
    var existingIndex = cart.items.findIndex(function (existing) {
      return (existing.variant_id || existing.product_id) === key;
    });

    if (existingIndex >= 0) {
      cart.items[existingIndex].quantity += item.quantity;
      cart.items[existingIndex].price = item.price || cart.items[existingIndex].price;
      cart.items[existingIndex].product_name = item.product_name || cart.items[existingIndex].product_name;
      cart.items[existingIndex].title = cart.items[existingIndex].product_name;
      cart.items[existingIndex].currency = item.currency || cart.items[existingIndex].currency;
    } else {
      cart.items.push(item);
    }

    return saveCart(recalculate(cart));
  }

  function updateItem(idOrVariantId, patch) {
    var cart = getCart();
    cart.items = cart.items.map(function (item) {
      var key = item.variant_id || item.product_id;
      if (key !== idOrVariantId) return item;
      return normalizeItem(Object.assign({}, item, patch || {}));
    }).filter(function (item) {
      return item.quantity > 0;
    });

    return saveCart(recalculate(cart));
  }

  function removeItem(idOrVariantId) {
    var cart = getCart();
    cart.items = cart.items.filter(function (item) {
      return item.product_id !== idOrVariantId && item.variant_id !== idOrVariantId;
    });

    return saveCart(recalculate(cart));
  }

  function clearCart() {
    var cart = emptyCart();
    saveCart(cart);
    return cart;
  }

  function getCart() {
    try {
      var parsed = JSON.parse(localStorage.getItem(config.storageKey) || "null");
      if (!parsed || !Array.isArray(parsed.items)) return emptyCart();
      return recalculate(parsed);
    } catch (_error) {
      return emptyCart();
    }
  }

  function saveCart(cart) {
    var normalized = recalculate(cart || emptyCart());
    normalized.updated_at = new Date().toISOString();
    localStorage.setItem(config.storageKey, JSON.stringify(normalized));
    log("Saved cart snapshot", normalized);
    window.dispatchEvent(new CustomEvent("cart-snapshot:updated", { detail: normalized }));
    return normalized;
  }

  function toCheckoutPayload() {
    var cart = getCart();
    return {
      total_price: cart.total_price,
      currency: cart.currency || config.currency,
      item_count: cart.item_count,
      items: cart.items.map(function (item) {
        return {
          id: item.variant_id || item.product_id,
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          title: item.product_name,
          product_name: item.product_name,
          price: item.price,
          currency: item.currency || cart.currency || config.currency,
          variant: {
            price: {
              amount: item.price,
              currencyCode: item.currency || cart.currency || config.currency
            }
          },
          finalLinePrice: {
            amount: roundMoney(item.price * item.quantity),
            currencyCode: item.currency || cart.currency || config.currency
          }
        };
      })
    };
  }

  function emptyCart() {
    return {
      version: 1,
      source: "cart-snapshot",
      currency: config.currency,
      item_count: 0,
      total_price: 0,
      items: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  function recalculate(cart) {
    cart.version = cart.version || 1;
    cart.source = cart.source || "cart-snapshot";
    cart.currency = cart.currency || config.currency;
    cart.items = (cart.items || []).map(normalizeItem).filter(function (item) {
      return item.quantity > 0;
    });
    cart.item_count = cart.items.reduce(function (sum, item) { return sum + item.quantity; }, 0);
    cart.total_price = roundMoney(cart.items.reduce(function (sum, item) { return sum + item.price * item.quantity; }, 0));
    cart.created_at = cart.created_at || new Date().toISOString();
    return cart;
  }

  function normalizeItem(item) {
    var productId = value(item.product_id || item.productId || item.id);
    var variantId = value(item.variant_id || item.variantId || productId);
    var name = value(item.product_name || item.productName || item.title || "");
    var quantity = positiveNumber(item.quantity, 1);
    var price = parseMoney(item.price || item.amount || 0);
    var currency = value(item.currency || config.currency).toUpperCase();

    return {
      product_id: productId,
      variant_id: variantId,
      product_name: name,
      title: name,
      quantity: quantity,
      price: price,
      currency: currency
    };
  }

  function readNearbyText(element, selector) {
    var scope = element.closest("[data-cart-product]") || element.closest("form") || document;
    var found = scope.querySelector(selector);
    return found ? found.textContent.trim() : "";
  }

  function attr(element, name) {
    return element.getAttribute(name) || "";
  }

  function value(input) {
    if (input === undefined || input === null) return "";
    return String(input).trim();
  }

  function positiveNumber(input, fallback) {
    var number = Number(input);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    return Math.round(number);
  }

  function parseMoney(input) {
    if (typeof input === "number") return roundMoney(input);
    var cleaned = String(input || "0").replace(/[^0-9.,-]/g, "").replace(/,/g, "");
    var number = Number(cleaned);
    return Number.isFinite(number) ? roundMoney(number) : 0;
  }

  function roundMoney(number) {
    return Math.round(Number(number || 0) * 100) / 100;
  }

  function log() {
    if (!config.debug) return;
    console.log.apply(console, ["[CartSnapshot]"].concat(Array.prototype.slice.call(arguments)));
  }

  function warn() {
    if (!config.debug) return;
    console.warn.apply(console, ["[CartSnapshot]"].concat(Array.prototype.slice.call(arguments)));
  }
})();
