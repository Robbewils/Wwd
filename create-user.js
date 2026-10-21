'use strict';
// Gebruik: node create-user.js <gebruikersnaam> <wachtwoord> [klant|admin]
const { db, hashPassword } = require('./db');

const [username, password, role = 'klant'] = process.argv.slice(2);
if (!username || !password || !['klant', 'admin'].includes(role)) {
  console.error('Gebruik: node create-user.js <gebruikersnaam> <wachtwoord> [klant|admin]');
  process.exit(1);
}
if (password.length < 5) {
  console.error('Wachtwoord moet minstens 5 tekens hebben.');
  process.exit(1);
}

hashPassword(password)
  .then((hash) => {
    db.prepare('INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, datetime())').run(username, hash, role);
    console.log(`Gebruiker "${username}" aangemaakt als ${role}.`);
  })
  .catch((err) => {
    console.error(err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'Die gebruikersnaam bestaat al.' : err.message);
    process.exit(1);
  });
