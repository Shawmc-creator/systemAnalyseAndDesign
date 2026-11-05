'use strict';
const {row}=require('./common');
class QuoteRepository{
 constructor(db){this.db=db;}
 head(id){return row(this.db,'treatment_quote',id);}
 version(id){return row(this.db,'quote_version',id);}
 versions(id){return this.db.prepare('SELECT * FROM quote_version WHERE quote_id=? ORDER BY version_no').all(id);}
 latest(id){return this.db.prepare('SELECT * FROM quote_version WHERE quote_id=? ORDER BY version_no DESC LIMIT 1').get(id);}
 issued(id){return this.db.prepare('SELECT * FROM quote_version WHERE quote_id=? AND issued_at IS NOT NULL ORDER BY version_no DESC LIMIT 1').get(id);}
 items(id){return this.db.prepare('SELECT * FROM quote_item WHERE quote_version_id=? ORDER BY sequence_no').all(id);}
 decisions(id){return this.db.prepare('SELECT * FROM quote_decision WHERE quote_item_id=? ORDER BY decided_at,id').all(id);}
 touch(id,now){this.db.prepare('UPDATE treatment_quote SET updated_at=?,revision=revision+1 WHERE id=?').run(now,id);}
}
module.exports={QuoteRepository};
