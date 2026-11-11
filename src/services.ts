// The services collection, sorted as the page lists them, and their prices.
import { type CollectionEntry, getCollection } from "astro:content";

export type Service = CollectionEntry<"services">;

export const getServices = async () =>
	(await getCollection("services")).sort((a, b) => a.data.order - b.data.order);

// A service's price as the card shows it: the base price, then each cheaper way to get it on its own
// line. Built from the numbers in the content, so a bundle's two cards, the JSON-LD and llms.txt
// can't disagree. Undefined when there's no price to give.
export function pricing({ id, data }: Service, services: Service[]) {
	if (data.price === undefined) return undefined;
	const name = (other: Service) => other.data.short ?? other.data.title;
	const deals = [];
	if (data.bulk) deals.push(`$${data.bulk.price} per ${data.per} for ${data.bulk.from} or more`);
	if (data.bundle) {
		const other = services.find((service) => service.id === data.bundle!.with.id);
		if (!other) throw new Error(`${id} bundles with unknown service ${data.bundle.with.id}`);
		deals.push(`$${data.bundle.price} with ${name(other)}`);
	}
	// The other side of a bundle shows what the two come to together.
	for (const other of services) {
		if (other.data.bundle?.with.id === id) deals.push(`$${data.price + other.data.bundle.price} with ${name(other)}`);
	}
	return { price: data.price, per: data.per && `per ${data.per}`, deals };
}

// The same as one sentence, for the request form's hint, the JSON-LD and llms.txt.
export function priceText(service: Service, services: Service[]) {
	const p = pricing(service, services);
	if (!p) return "Message us for a quote";
	return [[`$${p.price}`, p.per].filter(Boolean).join(" "), ...p.deals].join(", or ");
}
