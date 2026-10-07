import "dotenv/config";

process.env.DATABASE_URL ??= "file:./test.db";
