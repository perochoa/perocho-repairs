-- Customers can cancel or move their drop-off from a link of their own. Columns are added rather
-- than the table rebuilt, so offers can keep pointing at it (see 0002). A cancelled request keeps
-- the status it had, so status's CHECK stays as it is; `cancelled` is what closes it. The code still
-- live when this runs never reads either column: it files requests without a link, and nothing it
-- does sets `cancelled`.
ALTER TABLE requests ADD COLUMN customer_token TEXT; -- random; the customer's link is /requests/<token>. Null on requests from before
ALTER TABLE requests ADD COLUMN cancelled INTEGER; -- epoch ms the customer cancelled it; null until then

-- Every customer link is looked up by its token. Unique, so no two requests share one; SQLite lets
-- any number of rows have none.
CREATE UNIQUE INDEX requests_by_customer_token ON requests (customer_token);

-- Calendar events nothing points at any more, waiting to be deleted. A cancel or a move takes its
-- events off the offers and puts them here in the same transaction, then deletes them; whatever
-- Google wouldn't delete stays for the hourly job. Kept apart from offers, so a request can be
-- deleted on time whatever is left here.
CREATE TABLE stray_events (
	calendar_id TEXT NOT NULL,
	event_id TEXT NOT NULL,
	PRIMARY KEY (calendar_id, event_id)
);
