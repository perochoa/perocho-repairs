// The services collection, sorted as the page lists them, and their prices.
import { type CollectionEntry, getCollection } from "astro:content";

export type Service = CollectionEntry<"services">;

export const getServices = async () =>
	(await getCollection("services")).sort((a, b) => a.data.order - b.data.order);

// A service's price as the card shows it: the base price, then each cheaper way to get it, split into
// the condition and its price so the card can line them up ("for 4 or more sticks" / "$20 per
// stick"). Built from the numbers in the content, so a bundle's two cards, the JSON-LD and llms.txt
// can't disagree. Undefined when there's no price to give.
export function pricing({ id, data }: Service, services: Service[]) {
	if (data.price === undefined) return undefined;
	const name = (other: Service) => other.data.short ?? other.data.title;
	const per = data.per && `per ${data.per}`;
	const deals: { when: string; price: string }[] = [];
	if (data.bulk) deals.push({ when: `for ${data.bulk.from} or more ${data.per}s`, price: `$${data.bulk.price} ${per}` });
	if (data.bundle) {
		const other = services.find((service) => service.id === data.bundle!.with.id);
		if (!other) throw new Error(`${id} bundles with unknown service ${data.bundle.with.id}`);
		deals.push({ when: `with ${name(other)}`, price: `$${data.bundle.price}` });
	}
	// The other side of a bundle shows what the two come to together.
	for (const other of services) {
		if (other.data.bundle?.with.id === id)
			deals.push({ when: `with ${name(other)}`, price: `$${data.price + other.data.bundle.price} total` });
	}
	return { price: data.price, per, deals };
}

// The same as one sentence, for the request form's hint, the JSON-LD and llms.txt.
export function priceText(service: Service, services: Service[]) {
	const p = pricing(service, services);
	if (!p) return "Message us for a quote";
	const base = [`$${p.price}`, p.per].filter(Boolean).join(" ");
	return [base, ...p.deals.map(({ when, price }) => `${price} ${when}`)].join(", or ");
}

// A same-day fee as the form, the steps and llms.txt quote it: "$10", or a range like "$10–$20"
// when it isn't known yet which service (and so which device) it's for. The worker words its
// emails the same way (sameDayFee in worker/src/intake.ts).
export const feeText = (from: number, to = from) => (from === to ? `$${from}` : `$${from}–$${to}`);

// Every service's same-day fee, lowest to highest: what "Something else, or not sure" is quoted.
export function sameDayRange(services: Service[]) {
	const fees = services.map((service) => service.data.sameDay);
	return feeText(Math.min(...fees), Math.max(...fees));
}
