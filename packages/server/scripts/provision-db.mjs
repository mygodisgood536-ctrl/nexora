import pg from "pg";

const SUPERUSER_URL = "postgres://postgres:nexora-dev@localhost:5432/postgres";
const APP_USER = "nexora";
const APP_PASSWORD = "nexora";
const DATABASES = ["nexora_dev", "nexora_test"];

async function main() {
  const admin = new pg.Client({ connectionString: SUPERUSER_URL });
  await admin.connect();

  const userExists = await admin.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [APP_USER]);
  if (userExists.rowCount === 0) {
    await admin.query(`CREATE ROLE ${APP_USER} LOGIN PASSWORD '${APP_PASSWORD}'`);
    console.log(`created role ${APP_USER}`);
  } else {
    console.log(`role ${APP_USER} already exists`);
  }

  for (const dbName of DATABASES) {
    const dbExists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (dbExists.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${dbName} OWNER ${APP_USER}`);
      console.log(`created database ${dbName}`);
    } else {
      console.log(`database ${dbName} already exists`);
    }
  }

  await admin.end();

  for (const dbName of DATABASES) {
    const app = new pg.Client({
      connectionString: `postgres://${APP_USER}:${APP_PASSWORD}@localhost:5432/${dbName}`
    });
    await app.connect();
    const { rows } = await app.query("SELECT current_user, current_database()");
    console.log(`verified connection -> ${rows[0].current_user}@${rows[0].current_database}`);
    await app.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
