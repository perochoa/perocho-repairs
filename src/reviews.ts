import { site } from "./site";

// From the Marketplace profile (url). Update by hand now and then. Quotes have spelling, grammar
// and punctuation fixed, but keep the buyer's words and meaning: don't add claims they didn't make.
// Unset hides the reviews and every link to Marketplace.

interface Review {
	// First name only, as Marketplace shows it.
	name: string;
	date: string;
	stars: number;
	// The strengths the buyer ticked.
	notable: string[];
	text: string;
}

interface Marketplace {
	url: string;
	stars: number;
	ratings: number;
	// Strengths buyers ticked, with how many ticked each.
	strengths: { label: string; count: number }[];
	reviews: Review[];
}

// The "Highly rated" badge, shown only while the numbers earn it: Marketplace gives it for 4.5 stars
// or higher from at least 5 buyers.
export const highlyRated = (m: Marketplace) => m.stars >= 4.5 && m.ratings >= 5;

// A rating in whole stars, rounded: 4.8 draws five.
export const starRow = (stars: number) => "★".repeat(Math.round(stars));

export const marketplace: Marketplace | undefined = {
	url: `https://www.facebook.com/marketplace/profile/${site.facebookId}`,
	stars: 5,
	ratings: 80,
	strengths: [
		{ label: "Communication", count: 53 },
		{ label: "Punctuality", count: 51 },
		{ label: "Pricing", count: 30 },
		{ label: "Item description", count: 24 },
	],
	reviews: [
    {
      name: "Andrew",
      date: "2026-11-12",
      stars: 5,
      notable: ["Punctuality", "Communication", "Pricing", "Item description"],
      text: "Very trustworthy and fast process. Controller feels brand new!",
    },
    {
      name: "Jacob",
      date: "2026-11-11",
      stars: 5,
      notable: ["Punctuality", "Pricing"],
      text: "10/10 got it done in 17 minutes",
    },
		{
			name: "Michelle",
			date: "2026-10-13",
			stars: 5,
			notable: ["Punctuality", "Communication", "Pricing", "Item description"],
			text: "Amazing work, done for me in a couple of hours or even earlier, on the same day. Very helpful. Five stars!",
		},
		{
			name: "Aidan",
			date: "2026-10-09",
			stars: 5,
			notable: ["Communication", "Pricing"],
			text: "He did an awesome job. He helped me fix all the problems that needed to be fixed, he only charged me $100 for everything, and everything works perfectly.",
		},
		{
			name: "Sam",
			date: "2026-09-29",
			stars: 5,
			notable: ["Punctuality", "Communication", "Pricing", "Item description"],
			text: "Perfect! Thank you",
		}
	],
};
