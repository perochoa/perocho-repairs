-- A tech can mark an approved repair a no-show once its drop-off time has started and the customer
-- hasn't turned up, which takes it out of the queue without calling it done. Who did is kept, as
-- done_by is for done (see 0005). Added rather than the table rebuilt, so offers can keep pointing
-- at it (see 0002), and the code still live when this runs never reads either column: until the
-- new code is out, nothing is a no-show.
ALTER TABLE requests ADD COLUMN no_show INTEGER; -- epoch ms a tech marked it a no-show; null until then
ALTER TABLE requests ADD COLUMN no_show_by TEXT; -- the offer token of that tech
