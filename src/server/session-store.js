const session = require('express-session');

class BetterSqliteSessionStore extends session.Store {
  constructor(db) {
    super();
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        sess_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
    `);
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT sess_json, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expires_at <= Date.now()) {
        if (row) this.destroy(sid, () => {});
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess_json));
    } catch (error) {
      cb(error);
    }
  }

  set(sid, sess, cb = () => {}) {
    try {
      const maxAge = sess.cookie?.maxAge || 1000 * 60 * 60 * 24;
      const expiresAt = Date.now() + maxAge;
      if (!sess.createdAt) sess.createdAt = new Date().toISOString();
      this.db.prepare(`
        INSERT INTO sessions (sid, sess_json, expires_at) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess_json = excluded.sess_json, expires_at = excluded.expires_at
      `).run(sid, JSON.stringify(sess), expiresAt);
      cb(null);
    } catch (error) {
      cb(error);
    }
  }

  touch(sid, sess, cb = () => {}) {
    try {
      const maxAge = sess.cookie?.maxAge || 1000 * 60 * 60 * 24;
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(Date.now() + maxAge, sid);
      cb(null);
    } catch (error) {
      cb(error);
    }
  }

  destroy(sid, cb = () => {}) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb(null);
    } catch (error) {
      cb(error);
    }
  }

  listForUser(userId) {
    const now = Date.now();
    const rows = this.db.prepare('SELECT sid, sess_json, expires_at FROM sessions WHERE expires_at > ? ORDER BY expires_at DESC').all(now);
    return rows.map((row) => {
      try {
        const sess = JSON.parse(row.sess_json);
        if (Number(sess.user?.id) !== Number(userId)) return null;
        return {
          sid: row.sid,
          userAgent: sess.userAgent || '',
          ip: sess.ip || '',
          createdAt: sess.createdAt || null,
          expiresAt: new Date(row.expires_at).toISOString()
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  destroyForUser(userId, { exceptSid } = {}) {
    const sessions = this.listForUser(userId);
    const stmt = this.db.prepare('DELETE FROM sessions WHERE sid = ?');
    let count = 0;
    for (const sess of sessions) {
      if (exceptSid && sess.sid === exceptSid) continue;
      stmt.run(sess.sid);
      count += 1;
    }
    return count;
  }
}

module.exports = { BetterSqliteSessionStore };
