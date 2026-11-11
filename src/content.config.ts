import { defineCollection, reference } from "astro:content";
import { file, glob } from "astro/loaders";
import { z } from "astro/zod";

const services = defineCollection({
	loader: glob({ pattern: "*.md", base: "./src/content/services" }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			order: z.number(),
			// A photo across the top of the card, fading into it. Decorative: the card's text says it all.
			// Point at one already in the repo (../gallery/...) rather than adding a copy.
			photo: image().optional(),
			// What other services' price lines call this one ("$30 with HDMI port replacement").
			// Defaults to the title.
			short: z.string().optional(),
			// The base price in dollars, the big number on the card. Leave it unset to show "Message us
			// for a quote".
			price: z.number().optional(),
			// Makes `price` per item ("$25 per stick"), and gives the request form a "How many?" field.
			per: z.string().optional(),
			// A lower per-item price from a quantity up: "$20 per stick for 4 or more".
			bulk: z.object({ price: z.number(), from: z.number() }).optional(),
			// This service's price when done along with another. Both cards show it: this one as "$30 with
			// HDMI port replacement", the other as its total, "$130 with deep cleaning".
			bundle: z.object({ with: reference("services"), price: z.number() }).optional(),
			// Dollars added to have it done the same day it's dropped off (ahead of the queue), paid in
			// person. It goes by the device: less for a controller than a console. The worker keeps a
			// copy by title in SAME_DAY_FEES (wrangler.jsonc); worker/src/config.test.ts checks they match.
			sameDay: z.number(),
		}),
});

// One folder per repair: src/content/repairs/yyyy-mm-<slug>/index.md, with its photos beside it.
// Strip location data from photos before committing them: the repo is public.
const repairs = defineCollection({
	loader: glob({ pattern: "*/index.md", base: "./src/content/repairs" }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			device: z.string(),
			date: z.coerce.date(),
			before: image(),
			beforeAlt: z.string(),
			after: image(),
			afterAlt: z.string(),
		}),
});

// Single photos and short clips from the bench that aren't a before-and-after pair:
// src/content/gallery/gallery.yaml, with the photos beside it. Same rules as repairs: device only,
// location data stripped.
const gallery = defineCollection({
	loader: file("./src/content/gallery/gallery.yaml"),
	schema: ({ image }) =>
		z.object({
			photo: image(),
			alt: z.string(),
			caption: z.string(),
			date: z.coerce.date(),
			// A clip in public/ ("/videos/....mp4"), muted, with `photo` as its poster. Re-encode clips
			// small and without metadata: ffmpeg -map_metadata -1 -an, 720 wide, H.264.
			video: z.string().optional(),
		}),
});

export const collections = { services, repairs, gallery };
