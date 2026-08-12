/**
 * @fileoverview Database adapter factory.
 *
 * Architect: Omindu Dissanayaka (https://github.com/OminduDissanayaka)
 *
 * Only the adapter matching `db.provider` is ever `require()`'d, so the
 * other driver packages never load into memory — install just the one
 * you use (see each adapter file's header).
 *
 * Pass a ready-made custom adapter instead of a provider name via
 * `{ adapter: new MyAdapter(...) }` to bypass the built-in four entirely.
 */

'use strict';

/**
 * @param {object} dbConfig
 * @param {import('./BaseAdapter')} [dbConfig.adapter] - Pre-built custom adapter instance; if set, everything else is ignored.
 * @param {'d1'|'mongodb'|'mysql'|'postgres'} [dbConfig.provider]
 * @returns {import('./BaseAdapter')}
 */
function createAdapter(dbConfig = {}) {
  if (dbConfig.adapter) {
    return dbConfig.adapter;
  }

  const provider = (dbConfig.provider || 'd1').toLowerCase();

  switch (provider) {
    case 'd1': {
      const D1Adapter = require('./adapters/d1Adapter');
      return new D1Adapter(dbConfig);
    }
    case 'mongodb':
    case 'mongo': {
      const MongoAdapter = require('./adapters/mongoAdapter');
      return new MongoAdapter(dbConfig);
    }
    case 'mysql': {
      const MySQLAdapter = require('./adapters/mysqlAdapter');
      return new MySQLAdapter(dbConfig);
    }
    case 'postgres':
    case 'postgresql': {
      const PostgresAdapter = require('./adapters/postgresAdapter');
      return new PostgresAdapter(dbConfig);
    }
    default:
      throw new Error(
        `Unsupported db.provider "${provider}". Use one of: d1, mongodb, mysql, postgres — or pass db.adapter directly.`
      );
  }
}

module.exports = { createAdapter };
