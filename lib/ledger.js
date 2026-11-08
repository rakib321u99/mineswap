// Ledger — every MINE movement goes through here (balance + ledger row
// in one transaction). Amounts are integer MINE; negative = debit.
'use strict';

const { withTx } = require('./db');
const { dhakaDate } = require('./mining');

async function credit(conn, userId, source, amountMine, ref) {
  if (amountMine === 0) return;
  await conn.execute(
    'UPDATE users SET balance_mine = balance_mine + ? WHERE id = ?',
    [amountMine, userId]
  );
  await conn.execute(
    'INSERT INTO ledger (user_id, source, amount_mine, ref, ledger_date) VALUES (?, ?, ?, ?, ?)',
    [userId, source, amountMine, ref || '', dhakaDate(Date.now())]
  );
}

// Credit outside an existing transaction.
async function creditUser(userId, source, amountMine, ref) {
  return withTx((conn) => credit(conn, userId, source, amountMine, ref));
}

module.exports = { credit, creditUser };
