import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app";
import { signTestToken } from "./helpers";

describe("authentication foundation", () => {
  it("rejects /whoami without a token", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/whoami");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects a token signed with the wrong secret", async () => {
    const app = createApp();
    const jwt = (await import("jsonwebtoken")).default;
    const token = jwt.sign({ sub: "u1", companyId: "c1" }, "wrong-secret-wrong-secret", {
      algorithm: "HS256"
    });
    const res = await request(app).get("/api/v1/whoami").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and returns principal identity", async () => {
    const app = createApp();
    const token = signTestToken({ sub: "user-1", companyId: "company-1" });
    const res = await request(app).get("/api/v1/whoami").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe("user-1");
    expect(res.body.companyId).toBe("company-1");
    expect(res.body.requestId).toBeTruthy();
  });

  it("returns a request id header on every response", async () => {
    const app = createApp();
    const res = await request(app).get("/api/v1/healthz");
    expect(res.headers["x-request-id"]).toBeTruthy();
  });
});
