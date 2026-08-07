const { app } = require('electron');
app.whenReady().then(() => {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.exec('CREATE TABLE t(a TEXT)');
    db.prepare('INSERT INTO t VALUES (?)').run('hello');
    const row = db.prepare('SELECT a FROM t').get();
    console.log('NODE_SQLITE_OK', JSON.stringify(row));
  } catch (e) {
    console.log('NODE_SQLITE_FAIL', e.message.split('\n')[0]);
  }
  app.quit();
});
