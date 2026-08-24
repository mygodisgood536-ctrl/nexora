import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";

describe("GET /api/v1/healthz", () => {
  it("returns ok with database status", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("nexora-api");
    expect(["up", "down"]).toContain(res.body.db);
  });
});

describe("GET /platform/v1/healthz", () => {
  it("returns the platform surface identity", async () => {
    const app = createApp();
    const res = await request(app).get("/platform/v1/healthz");
    expect(res.status).toBe(200);
    expect(res.body.service).toBe("nexora-platform-api");
  });
});
