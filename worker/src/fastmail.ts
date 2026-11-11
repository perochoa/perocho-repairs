// Sends a plain-text email through Fastmail's JMAP API, from an identity on the token's account.

const SESSION = "https://api.fastmail.com/jmap/session";
const USING = [
	"urn:ietf:params:jmap:core",
	"urn:ietf:params:jmap:mail",
	"urn:ietf:params:jmap:submission",
];

// A JMAP method call or response: name, arguments, call id.
type Invocation = [string, Record<string, unknown>, string];

interface Identity {
	id: string;
	name: string;
	email: string;
}

// The first id a Mailbox/query found, e.g. the drafts mailbox.
function firstId([, result, callId]: Invocation): string {
	const ids = result.ids;
	if (!Array.isArray(ids) || typeof ids[0] !== "string") {
		throw new Error(`jmap: no ${callId} mailbox`);
	}
	return ids[0];
}

export interface Mail {
	from: string;
	to: string;
	replyTo?: string;
	subject: string;
	text: string;
}

// Sends them together: one session and one set of calls however many there are. Throws if any
// of them wasn't sent, though others may have gone out by then.
export async function sendMail(token: string, mails: Mail[]): Promise<void> {
	if (mails.length === 0) return;
	const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
	const sessionResponse = await fetch(SESSION, { headers });
	if (!sessionResponse.ok) throw new Error(`jmap session: ${sessionResponse.status}`);
	const session = (await sessionResponse.json()) as {
		apiUrl: string;
		primaryAccounts: Record<string, string>;
	};
	const accountId = session.primaryAccounts["urn:ietf:params:jmap:mail"];

	const call = async (methodCalls: Invocation[]) => {
		const response = await fetch(session.apiUrl, {
			method: "POST",
			headers,
			body: JSON.stringify({ using: USING, methodCalls }),
		});
		if (!response.ok) throw new Error(`jmap: ${response.status} ${await response.text()}`);
		const { methodResponses } = (await response.json()) as { methodResponses: Invocation[] };
		const error = methodResponses.find(([name]) => name === "error");
		if (error) throw new Error(`jmap: ${JSON.stringify(error[1])}`);
		return methodResponses;
	};

	const [identities, draftsMailbox, sentMailbox] = await call([
		["Identity/get", { accountId }, "identities"],
		["Mailbox/query", { accountId, filter: { role: "drafts" } }, "drafts"],
		["Mailbox/query", { accountId, filter: { role: "sent" } }, "sent"],
	]);
	const identityOf = (mail: Mail) => {
		const identity = (identities[1].list as Identity[]).find(
			(i) => i.email.toLowerCase() === mail.from.toLowerCase(),
		);
		if (!identity) throw new Error(`jmap: no identity for ${mail.from}`);
		return identity;
	};
	// Resolved once, before the request that sends, so a missing identity still sends nothing.
	const senders = mails.map(identityOf);
	const draftsId = firstId(draftsMailbox);
	const sentId = firstId(sentMailbox);

	// Mail to our own address arrives in the inbox anyway, so a Sent copy would sit beside it in the
	// same thread and look like a duplicate; drop the draft once it's sent instead.
	const toSelf = (mail: Mail) => mail.to.toLowerCase() === mail.from.toLowerCase();
	const drafts = Object.fromEntries(
		mails.map((mail, i) => [
			`draft${i}`,
			{
				mailboxIds: { [draftsId]: true },
				keywords: { $draft: true, $seen: true },
				from: [{ name: senders[i].name, email: senders[i].email }],
				to: [{ email: mail.to }],
				...(mail.replyTo && { replyTo: [{ email: mail.replyTo }] }),
				subject: mail.subject,
				bodyValues: { body: { value: mail.text } },
				textBody: [{ partId: "body", type: "text/plain" }],
			},
		]),
	);
	const sends = Object.fromEntries(
		mails.map((_, i) => [`send${i}`, { identityId: senders[i].id, emailId: `#draft${i}` }]),
	);
	const destroy = mails.flatMap((mail, i) => (toSelf(mail) ? [`#send${i}`] : []));
	const file = Object.fromEntries(
		mails.flatMap((mail, i) =>
			toSelf(mail)
				? []
				: [
						[
							`#send${i}`,
							{
								[`mailboxIds/${draftsId}`]: null,
								[`mailboxIds/${sentId}`]: true,
								"keywords/$draft": null,
							},
						],
					],
		),
	);

	const [created, submitted] = await call([
		["Email/set", { accountId, create: drafts }, "email"],
		[
			"EmailSubmission/set",
			{
				accountId,
				create: sends,
				...(destroy.length > 0 && { onSuccessDestroyEmail: destroy }),
				...(Object.keys(file).length > 0 && { onSuccessUpdateEmail: file }),
			},
			"submission",
		],
	]);
	if (created[1].notCreated) throw new Error(`jmap email: ${JSON.stringify(created[1].notCreated)}`);
	if (submitted[1].notCreated) throw new Error(`jmap submission: ${JSON.stringify(submitted[1].notCreated)}`);
}
