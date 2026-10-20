import { createPool, migrate } from "../db.js";

const pool = createPool();
await migrate(pool);
console.log("Schema is up to date.");
await pool.end();
