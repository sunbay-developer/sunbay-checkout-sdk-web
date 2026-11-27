import {
  fetchHealth,
  renderHealthBanner,
  getCreateCheckout,
  createSession,
} from "/app.js";
const el = (id) => document.getElementById(id);
const health = await fetchHealth();
renderHealthBanner(health, el("health"));
let checkout;
let busy = false;
function record(text) {
  el("log").textContent += `${text}\n`;
}
function destroy() {
  checkout?.destroy();
  checkout = undefined;
  el("slot-card").replaceChildren();
  el("slot-bill").replaceChildren();
  el("pay").disabled = true;
  el("destroy").disabled = true;
}
el("destroy").onclick = destroy;
el("init").onclick = async () => {
  if (busy) return;
  busy = true;
  el("init").disabled = true;
  destroy();
  el("status").textContent = "Creating session…";
  try {
    const issued = await createSession({
      customerId: el("customer").value.trim(),
      collectBillingAddress: true,
    });
    const customerAccessSecret = el("credential").checked
      ? issued.customerAccessSecret
      : undefined;
    if (el("credential").checked && !customerAccessSecret)
      throw new Error(
        "Customer credential was not issued. Check the demo customer and backend configuration.",
      );
    checkout = await getCreateCheckout()({
      sessionId: issued.sessionId,
      checkoutClientSecret: issued.checkoutClientSecret,
      customerAccessSecret,
      hostOrigin: health.hostedOrigin,
      appearance: {
        colorScheme: el("theme").value,
        ...(el("custom").checked
          ? {
              variables: { colorPrimary: "#2563eb" },
              rules: {
                savedCard: { padding: "16px" },
                "savedCard:selected": { borderWidth: "2px" },
                savedCardActions: { padding: "8px" },
              },
            }
          : {}),
      },
    });
    const card = checkout.create("card", {
      cardOnFile: {
        enabled: el("enabled").checked,
        saveByDefault: el("save").checked,
        managementEnabled: el("manage").checked,
        layout: { density: el("density").value, actions: el("actions").value },
      },
    });
    card.on("change", (event) =>
      record(
        `Card source ${event.cardSource ?? "new"}, complete ${event.complete === true}, save ${event.savePaymentMethod === true}`,
      ),
    );
    card.on("loadError", () => record("Card failed to load."));
    await card.mount("#slot-card");
    const billing = checkout.create("address", { mode: "billing" });
    await billing.mount("#slot-bill");
    el("pay").disabled = false;
    el("destroy").disabled = false;
    el("status").textContent =
      "Ready. After saving a card, create another session with the same customer.";
  } catch {
    destroy();
    el("status").textContent =
      "Initialization failed. Check customer credentials, backend and hosted runtime.";
    record("Initialization failed.");
  } finally {
    busy = false;
    el("init").disabled = false;
  }
};
el("pay").onclick = async () => {
  if (!checkout || busy) return;
  busy = true;
  el("pay").disabled = el("init").disabled = el("destroy").disabled = true;
  try {
    const outcome = await checkout.confirm();
    el("status").textContent = `Payment ${outcome.status}.`;
    record(`Payment ${outcome.status}.`);
  } catch (error) {
    if (error?.code === "VALIDATION_ERROR" || error?.code === "CHECKOUT_BUSY")
      el("pay").disabled = false;
    el("status").textContent =
      "Confirmation rejected. Review the card and current operation.";
  } finally {
    busy = false;
    el("init").disabled = el("destroy").disabled = false;
    // Use a fresh session after every acceptance payment, including unknown outcomes.
  }
};
for (const text of [
  "New customer shows a new-card form",
  "Save a new card with a successful Dev payment",
  "Fresh session for the same customer shows the saved card",
  "Switch between saved cards and new card; current selection stays clear",
  "Pay successfully using a saved card",
  "Remove a card with confirmation; verify disappearance in a fresh session",
  "Removing the selected / final card clears selection and reveals new-card entry",
  "Failed removal preserves the card and allows retry",
  "Management disabled hides its entry while selection and new-card payment work",
  "COF disabled / missing credential shows the ordinary card form",
  "Density, action layout, custom rules and light/dark render correctly",
]) {
  const row = document.createElement("label");
  row.style.display = "block";
  const result = document.createElement("select");
  for (const label of ["Pending", "Pass", "Fail"])
    result.add(new Option(label, label));
  result.setAttribute("aria-label", text);
  row.append(result, document.createTextNode(` ${text}`));
  el("checks").append(row);
}
