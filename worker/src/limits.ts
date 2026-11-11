// Limits, rules and wording the site and the worker share, imported by both so there's no copy to
// keep in step (like Outcome in outcomes.ts). Standalone, with no imports, because the site's
// request form imports it: importing intake.ts there would bring in the global Env type (through
// slots.ts), which the site's tsconfig can't resolve since it leaves out worker/. The form's
// client script bundles what it imports from here, so this also has to run in a browser.

// The most items (sticks) a request for a per-item service can be for: a few controllers' worth;
// more is a conversation. The form's quantity field stops here and intake.ts rejects more.
export const MAX_QUANTITY = 20;

// Loose on purpose: digits with the usual separators and an optional leading +, 10 to 15 digits
// (a local number with its area code, up to an international one). Spaces may lead it because the
// form checks the field as typed, while intake.ts checks it trimmed; either way it's kept as they
// typed it. The form's script warns while they type and intake.ts rejects what fails.
export const validPhone = (phone: string) => {
	const digits = phone.replace(/\D/g, "").length;
	return /^\s*\+?[\d\s().-]+$/.test(phone) && digits >= 10 && digits <= 15;
};

// Also loose: it catches typos and junk, not every invalid address. It asks for a dot in the domain,
// which a browser's own type="email" check doesn't ("jane@localhost" passes that), so the form's
// script checks with this as well and intake.ts rejects what fails. check-techs holds the techs'
// addresses in TECHS to the same rule.
export const validEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// A same-day fee in words: "$10", or a range like "$10–$20" when it isn't known yet which service
// (and so which device) it's for. The site quotes it on the form, the steps and llms.txt (through
// src/pricing.ts) and the worker's emails and tech pages quote it back (sameDayFee in intake.ts),
// so one wording keeps what a customer agreed to and what they're then told the same.
export const feeText = (from: number, to = from) => (from === to ? `$${from}` : `$${from}–$${to}`);
