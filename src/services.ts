// The services collection, sorted as the page lists them. Their prices as words are in pricing.ts.
import { type CollectionEntry, getCollection } from "astro:content";

export type Service = CollectionEntry<"services">;

export const getServices = async () =>
	(await getCollection("services")).sort((a, b) => a.data.order - b.data.order);
