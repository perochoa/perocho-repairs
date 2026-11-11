// The price wording customers read on the cards and the form, and search engines and AI assistants
// read in the JSON-LD and llms.txt. Fixtures, not the real content, so a price change doesn't
// break these; they're shaped like src/content/services/*.md.

import assert from "node:assert/strict";
import { test } from "node:test";
import { feeText, type PricedService, priceText, pricing, sameDayRange } from "./pricing.ts";

const sticks: PricedService = {
	id: "tmr-sticks",
	data: { title: "Stick drift fix", short: "stick drift fix", price: 25, per: "stick", bulk: { price: 20, from: 4 }, sameDay: 10 },
};
const cleaning: PricedService = {
	id: "cleaning",
	data: { title: "PS5 deep cleaning", short: "deep cleaning", price: 70, bundle: { with: { id: "hdmi-port" }, price: 30 }, sameDay: 20 },
};
// No `short`, so the other side of the bundle names it by its title.
const hdmi: PricedService = { id: "hdmi-port", data: { title: "PS5 HDMI port replacement", price: 100, sameDay: 20 } };
const quote: PricedService = { id: "quote", data: { title: "Something odd", sameDay: 15 } };
const services = [sticks, cleaning, hdmi, quote];

test("a plain price has no unit and no deals", () => {
	const solo: PricedService = { id: "solo", data: { title: "Solo", price: 40, sameDay: 20 } };
	assert.deepEqual(pricing(solo, [solo]), { price: 40, per: undefined, deals: [] });
	assert.equal(priceText(solo, [solo]), "$40");
});

test("a per-item price with a bulk deal from a quantity up", () => {
	assert.deepEqual(pricing(sticks, services), {
		price: 25,
		per: "per stick",
		deals: [{ when: "for 4 or more sticks", price: "$20 per stick" }],
	});
	assert.equal(priceText(sticks, services), "$25 per stick, or $20 per stick for 4 or more sticks");
});

test("a bundle shows its own price on one side and the total on the other", () => {
	assert.deepEqual(pricing(cleaning, services)?.deals, [{ when: "with PS5 HDMI port replacement", price: "$30" }]);
	assert.equal(priceText(cleaning, services), "$70, or $30 with PS5 HDMI port replacement");
	assert.deepEqual(pricing(hdmi, services)?.deals, [{ when: "with deep cleaning", price: "$130 total" }]);
	assert.equal(priceText(hdmi, services), "$100, or $130 total with deep cleaning");
});

test("no price means a quote", () => {
	assert.equal(pricing(quote, services), undefined);
	assert.equal(priceText(quote, services), "Message us for a quote");
});

test("a bundle with a service that isn't there throws rather than quoting half a deal", () => {
	assert.throws(() => pricing(cleaning, [cleaning]), { message: "cleaning bundles with unknown service hdmi-port" });
	assert.throws(() => priceText(cleaning, [cleaning]), /unknown service hdmi-port/);
});

test("a same-day fee is one amount, or a range when the device isn't known", () => {
	assert.equal(feeText(10), "$10");
	assert.equal(feeText(20, 20), "$20");
	assert.equal(feeText(10, 20), "$10–$20");
});

test("the same-day range spans every service's fee, whatever their order", () => {
	assert.equal(sameDayRange(services), "$10–$20");
	assert.equal(sameDayRange([hdmi, quote, sticks]), "$10–$20");
	assert.equal(sameDayRange([cleaning, hdmi]), "$20");
});
