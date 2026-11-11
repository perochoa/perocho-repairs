// Services' prices and same-day fees as words. Kept apart from services.ts, and typed on the plain
// fields it reads rather than CollectionEntry, so it has no astro:content import and `node --test`
// can run pricing.test.ts on it without Astro. A services collection entry fits this shape as is.

export interface PricedService {
	id: string;
	data: {
		title: string;
		// What other services' price lines call this one; defaults to the title.
		short?: string;
		price?: number;
		per?: string;
		bulk?: { price: number; from: number };
		// `with` is a collection reference; only its id matters here.
		bundle?: { with: { id: string }; price: number };
		sameDay: number;
	};
}

// A service's price as the card shows it: the base price, then each cheaper way to get it, split into
// the condition and its price so the card can line them up ("for 4 or more sticks" / "$20 per
// stick"). Built from the numbers in the content, so a bundle's two cards, the JSON-LD and llms.txt
// can't disagree. Undefined when there's no price to give.
export function pricing({ id, data }: PricedService, services: PricedService[]) {
	if (data.price === undefined) return undefined;
	const name = (other: PricedService) => other.data.short ?? other.data.title;
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
export function priceText(service: PricedService, services: PricedService[]) {
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
export function sameDayRange(services: PricedService[]) {
	const fees = services.map((service) => service.data.sameDay);
	return feeText(Math.min(...fees), Math.max(...fees));
}
