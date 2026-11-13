// The HTML shell of the pages the links open: a tech's request and repair queue, and the
// customer's request and its list of times. They look like the site's request form (its colours,
// cards and buttons), but they're the worker's own, so everything they need is inline here.

import { fields, type Intake } from "./intake.ts";

// The pages need nothing but their inline styles and forms that post back here. Customer text is
// escaped too; this is in case something slips through, and keeps the pages out of frames. No
// scripts, so the time picker works by CSS alone, and no fonts: the site's IBM Plex shows only
// where it's installed, and the system font otherwise.
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const escape = (text: string) =>
	text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The site's colours (src/layouts/BaseLayout.astro), light and dark, and the request form's cards,
// fields and time picker (src/pages/request/index.astro, src/components/SlotPicker.astro).
const STYLE = `
	:root {
		color-scheme: light dark;
		--bg: #f4f7f7; --surface: #ffffff; --ink: #12201f; --muted: #566866; --line: #d9e2e1;
		--accent: #0f766e; --on-accent: #ffffff; --warn: #b54708; --danger: #b42318;
	}
	@media (prefers-color-scheme: dark) {
		:root {
			--bg: #0e1514; --surface: #162120; --ink: #e3eceb; --muted: #93a5a3; --line: #23302f;
			--accent: #2dd4bf; --on-accent: #0e1514; --warn: #fdb022; --danger: #fda29b;
		}
	}
	body { margin: 0; min-height: 100vh; background: var(--bg); color: var(--ink); font: 1rem/1.5 "IBM Plex Sans", system-ui, sans-serif; }
	a { color: var(--accent); }
	:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

	.bar { border-bottom: 1px solid var(--line); }
	.bar p { box-sizing: border-box; display: flex; align-items: center; gap: 0.5rem; max-width: 44rem; min-height: 4rem; margin: 0 auto; padding: 0 1.25rem; font-size: 1.125rem; font-weight: 700; }
	.bar svg, .bar span { color: var(--accent); }

	main { box-sizing: border-box; display: grid; gap: 1.25rem; max-width: 44rem; margin: 0 auto; padding: clamp(2rem, 1.5rem + 3vw, 4rem) 1.25rem 4rem; }
	main > * { margin: 0; }
	.eyebrow { margin-bottom: -0.75rem; font: 500 0.8125rem/1.5 "IBM Plex Mono", ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
	h1 { font-size: clamp(1.75rem, 1.25rem + 2vw, 2.5rem); line-height: 1.15; letter-spacing: -0.02em; text-wrap: balance; }
	h2 { margin: 0; font-size: 1.125rem; }
	.state { color: var(--muted); font-size: 1.0625rem; }
	.note { color: var(--muted); font-size: 0.875rem; }

	.card { display: grid; gap: 1rem; padding: 1.5rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; }
	.card > * { margin: 0; }
	.request dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1.5rem; margin: 0; }
	.request dt { color: var(--muted); font-size: 0.9375rem; }
	.request dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
	.text h3 { margin: 0 0 0.25rem; color: var(--muted); font-size: 0.9375rem; font-weight: 400; }
	.text p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
	@media (max-width: 30rem) {
		.request dl { grid-template-columns: 1fr; gap: 0; }
		.request dd { margin-bottom: 0.5rem; }
	}

	/* Buttons and the links that act like them: approving, marking done and moving are the main
	   thing a page asks, so they're filled; cancelling is the one that can't be undone. */
	.actions { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
	.actions form { display: contents; }
	button, .button {
		box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
		padding: 0.75rem 1.375rem; border: 1px solid var(--line); border-radius: 0.5rem; background: transparent;
		color: var(--ink); font: inherit; font-weight: 600; text-decoration: none; cursor: pointer;
		transition: background-color 0.15s, border-color 0.15s, color 0.15s, transform 0.1s;
	}
	button:hover, .button:hover { border-color: var(--accent); color: var(--accent); }
	button:active, .button:active { transform: translateY(1px) scale(0.98); }
	button[value="confirm"], button[value="done"], button.primary, .button.primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
	button[value="confirm"]:hover, button[value="done"]:hover, button.primary:hover, .button.primary:hover { background: color-mix(in srgb, var(--accent) 85%, var(--ink)); color: var(--on-accent); }
	button[value="cancel"] { border-color: color-mix(in srgb, var(--danger) 45%, var(--line)); color: var(--danger); }
	button[value="cancel"]:hover { border-color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); color: var(--danger); }
	@media (max-width: 40rem) {
		.actions > *, .actions button { flex: 1 1 100%; }
	}

	/* The customer's way through: sent, confirmed, done. */
	.progress { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; padding: 0; list-style: none; font-size: 0.875rem; color: var(--muted); }
	.progress li { padding-top: 0.625rem; border-top: 4px solid var(--line); }
	.progress .reached { border-color: var(--accent); }
	.progress [aria-current] { color: var(--ink); font-weight: 600; }

	/* What a tech needs at a glance: same-day, where it comes in, and how to reach the customer. */
	.rush, .notice { padding: 0.875rem 1.25rem; border: 1px solid; border-radius: 0.75rem; font-weight: 600; }
	.rush { border-color: color-mix(in srgb, var(--warn) 50%, transparent); background: color-mix(in srgb, var(--warn) 10%, transparent); color: var(--warn); }
	.notice { border-color: var(--accent); background: var(--surface); }
	.address { color: var(--muted); }
	.contacts { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.call { margin: 0; }
	.call a { display: inline-block; padding: 0.5rem 0.875rem; border: 1px solid var(--line); border-radius: 0.5rem; background: var(--surface); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
	.call a:hover { border-color: var(--accent); }
	.mine { font-weight: 600; }

	/* The repair queue: a card a repair, numbered in the order to work them. */
	.queue { display: grid; gap: 0.75rem; padding: 0; list-style: none; counter-reset: queue; }
	.queue li { position: relative; padding: 1rem 1.25rem 1rem 3.5rem; background: var(--surface); border: 1px solid var(--line); border-radius: 0.75rem; counter-increment: queue; }
	.queue li::before { content: counter(queue); position: absolute; left: 1.25rem; top: 1rem; font: 500 0.875rem/1.6 "IBM Plex Mono", ui-monospace, monospace; color: var(--muted); }
	.queue .what { font-size: 1.0625rem; font-weight: 700; color: var(--ink); text-decoration: none; }
	.queue a.what:hover { color: var(--accent); }
	.queue .details { display: inline-block; margin-top: 0.25rem; color: var(--muted); font-size: 0.9375rem; overflow-wrap: anywhere; }

	/* The customer's times, picked like on the form: a day, then one of its times. Each day's times
	   are a form of their own, so only a time on the day showing can be sent. */
	.months { display: flex; flex-wrap: wrap; gap: 0.375rem; }
	.months a { padding: 0.375rem 0.75rem; border: 1px solid var(--line); border-radius: 999px; color: var(--ink); font-size: 0.875rem; font-weight: 600; text-decoration: none; }
	.months a:hover { border-color: var(--accent); }
	.months a[aria-current] { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
	.days { display: grid; grid-template-columns: repeat(auto-fill, minmax(4.25rem, 1fr)); gap: 0.375rem; }
	.day, .times label { position: relative; border: 1px solid var(--line); background: var(--bg); cursor: pointer; }
	.day { display: grid; justify-items: center; padding: 0.5rem 0; border-radius: 0.625rem; line-height: 1.3; }
	.day:hover, .times label:hover { border-color: var(--accent); }
	.day .weekday, .day .month { color: var(--muted); font-size: 0.75rem; }
	.day .date { font-size: 1.0625rem; font-weight: 700; font-variant-numeric: tabular-nums; }
	.day:has(:checked), .times label:has(:checked) { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
	.day:has(:checked) span { color: inherit; }
	.day:has(:focus-visible), .times label:has(:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
	/* The row is the radio: the input is only there for the form and the keyboard. */
	.day input, .times input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }
	.panel { display: none; gap: 0.75rem; }
	.picked { margin: 0; font-weight: 600; }
	.times { display: grid; grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr)); gap: 0.375rem; max-height: 18rem; overflow-y: auto; overscroll-behavior: contain; }
	.times label { display: block; padding: 0.625rem 0.875rem; border-radius: 0.5rem; font-variant-numeric: tabular-nums; }
	.panel button { justify-self: start; }
	@media (max-width: 40rem) {
		.panel button { justify-self: stretch; }
	}
	/* Without :has(), every day's times show, each under its own date. */
	@supports not selector(:has(*)) {
		.days { display: none; }
		.panel { display: grid; }
	}
`;

// The site's logo: the worn ring where the stick drifted, and the fixed disc.
const LOGO = `<svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true"><circle cx="38" cy="26" r="15" fill="none" stroke="currentColor" stroke-width="5" opacity=".45"/><circle cx="28" cy="36" r="15" fill="currentColor"/></svg>`;

export const html = (title: string, body: string, status = 200) =>
	new Response(
		`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#f4f7f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0e1514" media="(prefers-color-scheme: dark)">
<title>${escape(title)} · Perocho Repairs</title>
<style>${STYLE}</style>
</head>
<body>
<header class="bar"><p>${LOGO} Perocho <span>Repairs</span></p></header>
<main>
${body}
</main>
</body>
</html>`,
		{
			status,
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Cache-Control": "no-store",
				"Content-Security-Policy": CSP,
			},
		},
	);

// A page with nothing to do on it but read why: a link that matches nothing, a limit, an error.
export const message = (title: string, text: string, status: number) =>
	html(title, `<h1>${escape(title)}</h1>\n<p class="state">${escape(text)}</p>`, status);

// The request as the customer sent it, under `heading`: its labelled lines, then what's wrong and
// any notes, which keep their line breaks.
export function request(heading: string, intake: Intake, time: string) {
	const lines = fields(intake, time).map(([label, value]) => `<dt>${escape(label)}</dt><dd>${escape(value)}</dd>`);
	const text = (label: string, value: string) => `<div class="text"><h3>${label}</h3><p>${escape(value)}</p></div>`;
	return `<section class="card request">
<h2>${escape(heading)}</h2>
<dl>
${lines.join("\n")}
</dl>
${text("What's wrong", intake.problem)}${intake.notes ? text("Notes", intake.notes) : ""}
</section>`;
}
